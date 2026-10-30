from __future__ import annotations
import hashlib
import json
import os
import socket
import subprocess
import threading
import time
from pathlib import Path
from typing import Any


class PreviewManager:
    """
    Local preview manager for generated Next.js + Node.js projects.

    Starts the frontend and, when a Node backend package is present, the
    backend as separate persistent processes. This in-memory manager is intended
    for a single Django worker in local development.
    """

    STARTUP_TIMEOUT = 90
    BACKEND_STARTUP_TIMEOUT = 30
    HEALTH_CHECK_INTERVAL = 0.5

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._previews: dict[int, dict[str, Any]] = {}

    def _new_state(self) -> dict[str, Any]:
        return {
            "status": "stopped",
            "url": None,
            "logs": [],
            "error": None,
            "process": None,  # Kept for compatibility with older callers.
            "processes": {},
            "thread": None,
            "port": None,
            "backend_port": None,
            "generation": 0,
        }

    def _state(self, project_id: int) -> dict[str, Any]:
        if project_id not in self._previews:
            self._previews[project_id] = self._new_state()
        return self._previews[project_id]

    def _log(self, state: dict[str, Any], message: str) -> None:
        with self._lock:
            state["logs"].append(str(message).rstrip())
            state["logs"] = state["logs"][-500:]

    def _find_port(self) -> int:
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            return int(sock.getsockname()[1])

    def _read_package(self, directory: Path) -> dict[str, Any] | None:
        package_json = directory / "package.json"
        if not package_json.is_file():
            return None
        try:
            with package_json.open("r", encoding="utf-8") as file:
                data = json.load(file)
            return data if isinstance(data, dict) else None
        except (OSError, json.JSONDecodeError):
            return None

    def _find_frontend(self, workspace: Path) -> tuple[Path, dict[str, Any]]:
        candidates = [
            workspace / "frontend",
            workspace / "client",
            workspace / "web",
            workspace,
        ]
        for directory in candidates:
            package = self._read_package(directory)
            if not package:
                continue
            dependencies = {
                **(package.get("dependencies") or {}),
                **(package.get("devDependencies") or {}),
            }
            scripts = package.get("scripts") or {}
            if "next" in dependencies and isinstance(scripts, dict) and scripts.get("dev"):
                return directory, package

        raise FileNotFoundError(
            "Could not find a Next.js frontend with a 'dev' script. Checked: "
            + ", ".join(str(path) for path in candidates)
        )

    def _find_backend(
        self, workspace: Path, frontend_directory: Path
    ) -> tuple[Path, dict[str, Any]] | None:
        candidates = [
            workspace / "backend",
            workspace / "server",
            workspace / "api",
            workspace / "backend-node",
        ]
        for directory in candidates:
            if directory.resolve() == frontend_directory.resolve():
                continue
            package = self._read_package(directory)
            if not package:
                continue
            scripts = package.get("scripts") or {}
            dependencies = {
                **(package.get("dependencies") or {}),
                **(package.get("devDependencies") or {}),
            }
            # Do not mistake another frontend package for the backend.
            if "next" in dependencies:
                continue
            if isinstance(scripts, dict) and (
                scripts.get("dev") or scripts.get("start") or scripts.get("serve")
            ):
                return directory, package

        # If the root is a backend package and frontend is nested, allow it.
        if workspace.resolve() != frontend_directory.resolve():
            package = self._read_package(workspace)
            if package:
                scripts = package.get("scripts") or {}
                dependencies = {
                    **(package.get("dependencies") or {}),
                    **(package.get("devDependencies") or {}),
                }
                if (
                    "next" not in dependencies
                    and isinstance(scripts, dict)
                    and (scripts.get("dev") or scripts.get("start") or scripts.get("serve"))
                ):
                    return workspace, package
        return None

    def _npm_command(self, args: list[str]) -> list[str]:
        # On Windows, npm.cmd is a batch file and must be launched through cmd.
        if os.name == "nt":
            return ["cmd.exe", "/d", "/s", "/c", subprocess.list2cmdline(["npm.cmd", *args])]
        return ["npm", *args]

    
    def _install_dependencies(
        self,
        directory: Path,
        state: dict[str, Any],
        label: str,
    ) -> None:
        package = directory / "package.json"
        lockfiles = [
            directory / "package-lock.json",
            directory / "npm-shrinkwrap.json",
        ]
        node_modules = directory / "node_modules"
        stamp = directory / ".prompt2web-deps.sha256"

        # Calculate a fingerprint of the dependency manifests.
        fingerprint = self._dependency_fingerprint(directory)

        # Skip npm installation when dependencies have not changed.
        if node_modules.is_dir() and stamp.is_file():
            try:
                cached_fingerprint = stamp.read_text(
                    encoding="utf-8"
                ).strip()

                if cached_fingerprint == fingerprint:
                    self._log(
                        state,
                        f"[{label}] Dependencies unchanged; skipping npm install.",
                    )
                    return

            except OSError:
                # If the cache stamp cannot be read, install normally.
                pass

        # Use npm ci when a lockfile exists; otherwise use npm install.
        command = (
            ["ci", "--no-audit", "--no-fund"]
            if any(path.is_file() for path in lockfiles)
            else ["install", "--no-audit", "--no-fund"]
        )

        self._log(
            state,
            f"[{label}] Installing dependencies in {directory} ...",
        )

        result = subprocess.run(
            self._npm_command(command),
            cwd=str(directory),
            capture_output=True,
            text=True,
            timeout=600,
            shell=False,
        )

        for line in (result.stdout + "\n" + result.stderr).splitlines():
            if line.strip():
                self._log(state, f"[{label}] {line}")

        if result.returncode != 0:
            raise RuntimeError(
                f"{label} dependency installation failed "
                f"(exit code {result.returncode})."
            )

        # Record the fingerprint only after successful installation.
        stamp.write_text(fingerprint, encoding="utf-8")

        self._log(
            state,
            f"[{label}] Dependencies installed successfully.",
        )

    def _start_process(
        self,
        directory: Path,
        script: str,
        port: int,
        label: str,
        state: dict[str, Any],
        backend_url: str | None = None,
    ) -> subprocess.Popen:
        env = os.environ.copy()
        env["PORT"] = str(port)
        env["HOST"] = "127.0.0.1"
        env["HOSTNAME"] = "127.0.0.1"
        env["BROWSER"] = "none"

        # Make the dynamically selected backend URL available to common Next.js
        # and Node configuration conventions. Generated frontend code must read
        # one of these variables for this to affect its API requests.
        if label == "frontend" and backend_url:
            for key in (
                "NEXT_PUBLIC_API_URL",
                "NEXT_PUBLIC_API_BASE_URL",
                "NEXT_PUBLIC_BACKEND_URL",
                "NEXT_PUBLIC_BACKEND_API_URL",
                "API_URL",
                "BACKEND_URL",
            ):
                env[key] = backend_url
        elif label == "backend":
            frontend_url = f"http://127.0.0.1:{state.get('port')}" if state.get("port") else ""
            env["FRONTEND_URL"] = frontend_url
            env["CLIENT_URL"] = frontend_url
            env["CORS_ORIGIN"] = frontend_url

        self._log(state, f"[{label}] Starting npm run {script} on port {port} ...")
        # Next.js accepts --hostname/--port. For generic Node backends, avoid
        # injecting CLI flags because Express scripts often do not parse them;
        # pass PORT/HOST through the environment instead.
        args = ["run", script]
        if label == "frontend":
            args += ["--", "--hostname", "127.0.0.1", "--port", str(port)]
        command = self._npm_command(args)
        return subprocess.Popen(
            command,
            cwd=str(directory),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            shell=False,
        )

    def _reader(self, project_id: int, generation: int, label: str, process: subprocess.Popen) -> None:
        state = self._state(project_id)
        try:
            if process.stdout is not None:
                for line in process.stdout:
                    self._log(state, f"[{label}] {line}")
                    with self._lock:
                        if state["generation"] != generation:
                            return
            return_code = process.wait()
            with self._lock:
                if state["generation"] == generation and state["status"] in ("starting", "running"):
                    state["status"] = "failed"
                    state["url"] = None
                    state["error"] = f"{label} process exited with code {return_code}."
                    self._log(state, f"[{label}] Process exited with code {return_code}.")
        except Exception as exc:
            self._log(state, f"[{label}] Log reader error: {exc}")

    def _port_is_open(self, port: int) -> bool:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                return True
        except OSError:
            return False

    def get_status(self, project_id: int) -> dict[str, Any]:
        with self._lock:
            state = self._state(project_id)
            processes = state.get("processes") or {}
            dead = [
                name for name, process in processes.items()
                if process is not None and process.poll() is not None
            ]
            if dead and state["status"] in ("starting", "running"):
                name = dead[0]
                process = processes[name]
                state["status"] = "failed"
                state["error"] = f"{name} process exited with code {process.returncode}."
                state["url"] = None
                self._log(state, state["error"])

            return {
                "status": state["status"],
                "url": state["url"],
                "frontend_url": state["url"],
                "backend_url": (
                    f"http://127.0.0.1:{state['backend_port']}"
                    if state.get("backend_port") else None
                ),
                "logs": list(state["logs"]),
                "error": state["error"],
                "services": {
                    name: ("running" if process.poll() is None else "stopped")
                    for name, process in processes.items()
                    if process is not None
                },
            }

    def start(self, project_id: int, workspace: Path) -> dict[str, Any]:
        workspace = workspace.resolve()
        if not workspace.is_dir():
            raise FileNotFoundError(f"Generated workspace does not exist: {workspace}")

        frontend_dir, frontend_package = self._find_frontend(workspace)
        backend_found = self._find_backend(workspace, frontend_dir)

        with self._lock:
            state = self._state(project_id)
            if state["status"] in ("starting", "running"):
                processes = state.get("processes") or {}
                if processes and all(p.poll() is None for p in processes.values()):
                    return self.get_status(project_id)

            old_processes = list((state.get("processes") or {}).values())
            state["generation"] += 1
            generation = state["generation"]
            frontend_port = self._find_port()
            # Generated frontend templates commonly call the Express API at
            # http://localhost:5000. Keep the backend on that port so those
            # existing API URLs work without requiring a frontend code rewrite.
            # If port 5000 is already occupied, startup validation below will
            # fail with a clear error rather than silently using the wrong port.
            backend_port = 5000 if backend_found else None
            state.update({
                "status": "starting",
                "url": f"http://127.0.0.1:{frontend_port}",
                "logs": [
                    f"Workspace: {workspace}",
                    f"Frontend directory: {frontend_dir}",
                ],
                "error": None,
                "process": None,
                "processes": {},
                "port": frontend_port,
                "backend_port": backend_port,
                "thread": None,
            })

        for process in old_processes:
            if process is not None:
                self._terminate_process(process)

        worker = threading.Thread(
            target=self._run,
            args=(project_id, workspace, frontend_dir, frontend_package, backend_found,
                  frontend_port, backend_port, generation),
            daemon=True,
        )
        with self._lock:
            state["thread"] = worker
        worker.start()
        return self.get_status(project_id)

    def _run(
        self,
        project_id: int,
        workspace: Path,
        frontend_dir: Path,
        frontend_package: dict[str, Any],
        backend_found: tuple[Path, dict[str, Any]] | None,
        frontend_port: int,
        backend_port: int | None,
        generation: int,
    ) -> None:
        state = self._state(project_id)
        try:
            self._install_dependencies(frontend_dir, state, "frontend")
            if backend_found:
                backend_dir, _ = backend_found
                if backend_dir.resolve() != frontend_dir.resolve():
                    self._install_dependencies(backend_dir, state, "backend")
                self._log(state, f"[backend] Directory: {backend_dir}")
            else:
                self._log(
                    state,
                    "[backend] No Node backend package with a dev/start script found; starting frontend only.",
                )

            with self._lock:
                if state["generation"] != generation:
                    return

            # Start backend first so the frontend can call its API.
            if backend_found and backend_port is not None:
                backend_dir, backend_package = backend_found
                if self._port_is_open(backend_port):
                    raise RuntimeError(
                        f"Backend port {backend_port} is already in use. "
                        "Stop the manually running backend, then click Run again."
                    )
                scripts = backend_package.get("scripts") or {}
                backend_script = next(
                    (name for name in ("dev", "start", "serve") if scripts.get(name)),
                    None,
                )
                if not backend_script:
                    raise RuntimeError(
                        f"Backend package at {backend_dir} has no dev, start, or serve script."
                    )
                backend_process = self._start_process(
                    backend_dir, backend_script, backend_port, "backend", state
                )
                with self._lock:
                    if state["generation"] != generation:
                        self._terminate_process(backend_process)
                        return
                    state["processes"]["backend"] = backend_process
                threading.Thread(
                    target=self._reader,
                    args=(project_id, generation, "backend", backend_process),
                    daemon=True,
                ).start()

                deadline = time.monotonic() + self.BACKEND_STARTUP_TIMEOUT
                while time.monotonic() < deadline:
                    if backend_process.poll() is not None:
                        raise RuntimeError(
                            f"Backend exited during startup (code {backend_process.returncode}). "
                            "Check [backend] logs and its package.json start script."
                        )
                    if self._port_is_open(backend_port):
                        self._log(state, f"[backend] Listening on http://127.0.0.1:{backend_port}")
                        break
                    time.sleep(self.HEALTH_CHECK_INTERVAL)
                else:
                    raise TimeoutError(
                        f"Backend did not listen on 127.0.0.1:{backend_port} within "
                        f"{self.BACKEND_STARTUP_TIMEOUT} seconds. The backend may use a "
                        "hard-coded port instead of process.env.PORT, or its startup script "
                        "may not launch the Express server. Check the [backend] logs."
                    )

            backend_url = (
                f"http://127.0.0.1:{backend_port}" if backend_port is not None else None
            )
            frontend_process = self._start_process(
                frontend_dir,
                "dev",
                frontend_port,
                "frontend",
                state,
                backend_url=backend_url,
            )
            if backend_url:
                self._log(
                    state,
                    "[frontend] Backend URL environment set to " + backend_url
                    + ". The generated frontend must read NEXT_PUBLIC_API_URL, "
                    + "NEXT_PUBLIC_API_BASE_URL, or NEXT_PUBLIC_BACKEND_URL to use it.",
                )
            with self._lock:
                if state["generation"] != generation:
                    self._terminate_process(frontend_process)
                    return
                state["process"] = frontend_process
                state["processes"]["frontend"] = frontend_process

            threading.Thread(
                target=self._reader,
                args=(project_id, generation, "frontend", frontend_process),
                daemon=True,
            ).start()

            deadline = time.monotonic() + self.STARTUP_TIMEOUT
            while time.monotonic() < deadline:
                with self._lock:
                    if state["generation"] != generation:
                        self._terminate_process(frontend_process)
                        return
                    if state["status"] == "failed":
                        raise RuntimeError(state["error"] or "A service failed to start.")
                if frontend_process.poll() is not None:
                    raise RuntimeError(
                        f"Frontend exited during startup (code {frontend_process.returncode})."
                    )
                if self._port_is_open(frontend_port):
                    with self._lock:
                        if state["generation"] == generation and state["status"] == "starting":
                            state["status"] = "running"
                    self._log(state, f"[frontend] Ready at http://127.0.0.1:{frontend_port}")
                    return
                time.sleep(self.HEALTH_CHECK_INTERVAL)

            raise TimeoutError(
                f"Frontend did not become reachable within {self.STARTUP_TIMEOUT} seconds."
            )

        except Exception as exc:
            self._log(state, f"Startup error: {exc}")
            with self._lock:
                if state["generation"] == generation:
                    state["status"] = "failed"
                    state["url"] = None
                    state["error"] = str(exc)
                    processes = list((state.get("processes") or {}).values())
            for process in processes if "processes" in locals() else []:
                self._terminate_process(process)

    def _terminate_process(self, process: subprocess.Popen) -> None:
        if process.poll() is not None:
            return
        try:
            if os.name == "nt":
                subprocess.run(
                    ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                    capture_output=True,
                    timeout=10,
                    check=False,
                )
            else:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
        except (OSError, subprocess.SubprocessError):
            try:
                process.kill()
            except OSError:
                pass

    def stop(self, project_id: int) -> dict[str, Any]:
        with self._lock:
            state = self._state(project_id)
            state["generation"] += 1
            processes = list((state.get("processes") or {}).values())
            # Also stop an older state created before the dual-process version.
            if not processes and state.get("process") is not None:
                processes = [state["process"]]
            state["status"] = "stopped"
            state["url"] = None
            state["error"] = None
            state["process"] = None
            state["processes"] = {}
            state["thread"] = None
            state["port"] = None
            state["backend_port"] = None

        for process in processes:
            if process is not None:
                self._terminate_process(process)

        self._log(state, "Project stopped.")
        return self.get_status(project_id)

    def _dependency_fingerprint(self, directory: Path) -> str:
        digest = hashlib.sha256()

        for filename in (
            "package.json",
            "package-lock.json",
            "npm-shrinkwrap.json",
        ):
            path = directory / filename
            digest.update(filename.encode("utf-8"))

            if path.is_file():
                digest.update(path.read_bytes())

        return digest.hexdigest()

preview_manager = PreviewManager()
