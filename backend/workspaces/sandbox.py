
from .docker import DockerSandbox


class ProjectSandbox:
    def __init__(self, workspace_manager):
        self.workspace = workspace_manager
        self.docker = DockerSandbox(workspace_manager)

    def _frontend_cwd(self) -> str:
        files = set(self.workspace.list_files())

        if "package.json" in files:
            return "."

        if "frontend/package.json" in files:
            return "frontend"

        raise FileNotFoundError(
            "Next.js package.json was not found "
            "in the workspace root or frontend directory."
        )

    def install_frontend(self):
        return self.docker.run(
            [
                "npm",
                "install",
                "--no-audit",
                "--no-fund",
            ],
            cwd=self._frontend_cwd(),
            timeout=900,
        )

    def build_frontend(self):
        return self.docker.run(
            ["npm", "run", "build"],
            cwd=self._frontend_cwd(),
            timeout=600,
        )

    def run_frontend_command(
        self,
        command: list[str],
        timeout: int = 600,
    ):
        return self.docker.run(
            command,
            cwd=self._frontend_cwd(),
            timeout=timeout,
        )
