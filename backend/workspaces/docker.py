
import shutil
import subprocess
from dataclasses import dataclass

from .exceptions import (
    CommandTimeoutError,
    WorkspaceNotFoundError,
    SandboxUnavailableError,
)


@dataclass
class DockerCommandResult:
    command: list[str]
    return_code: int
    stdout: str
    stderr: str

    @property
    def success(self) -> bool:
        return self.return_code == 0


class DockerSandbox:
    IMAGE = "node:24-bookworm"

    def __init__(self, workspace_manager):
        self.workspace = workspace_manager

    def ensure_docker_available(self) -> str:
        docker = shutil.which("docker")

        if docker is None:
            raise SandboxUnavailableError(
                "Docker CLI was not found. "
                "Install Docker Desktop and make sure it is running."
            )

        return docker

    def ensure_docker_running(self) -> str:
        docker = self.ensure_docker_available()

        try:
            process = subprocess.run(
                [docker, "info"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=60,
                shell=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise SandboxUnavailableError(
                "Docker did not respond in time."
            ) from exc

        if process.returncode != 0:
            raise SandboxUnavailableError(
                "Docker is installed but the daemon is not running "
                "or cannot be reached.\n\n"
                f"{process.stderr or process.stdout}"
            )

        return docker

    def run(
        self,
        command: list[str],
        cwd: str = "",
        timeout: int = 300,
    ) -> DockerCommandResult:
        if not self.workspace.exists():
            raise WorkspaceNotFoundError(
                f"Workspace not found for project "
                f"{self.workspace.project.id}"
            )

        if cwd not in {"", ".", "frontend"}:
            raise ValueError(
                f"Unsupported working directory: {cwd}"
            )

        if not command:
            raise ValueError("Docker command cannot be empty.")

        docker = self.ensure_docker_running()

        host_workspace = str(
            self.workspace.workspace_path.resolve()
        )
        project_id = self.workspace.project.id

        is_frontend_subdirectory = cwd == "frontend"

        container_workdir = (
            "/workspace/frontend"
            if is_frontend_subdirectory
            else "/workspace"
        )

        volume_name = (
            f"project_{project_id}_frontend_node_modules"
            if is_frontend_subdirectory
            else f"project_{project_id}_root_node_modules"
        )

        docker_command = [
            docker,
            "run",
            "--rm",
            "--memory",
            "2g",
            "--cpus",
            "2",
            "--pids-limit",
            "256",
            "--network",
            "bridge",
            "--workdir",
            container_workdir,
            "--volume",
            f"{host_workspace}:/workspace",
            "--volume",
            f"{volume_name}:{container_workdir}/node_modules",
            self.IMAGE,
            *command,
        ]

        try:
            process = subprocess.run(
                docker_command,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
                shell=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise CommandTimeoutError(
                f"Docker command timed out after {timeout} seconds."
            ) from exc

        return DockerCommandResult(
            command=command,
            return_code=process.returncode,
            stdout=process.stdout,
            stderr=process.stderr,
        )
