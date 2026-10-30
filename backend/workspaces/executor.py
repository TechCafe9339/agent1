import shutil
import subprocess

from dataclasses import dataclass

from .exceptions import (
    CommandTimeoutError,
    InvalidCommandError,
)


@dataclass
class CommandResult:
    command: list[str]
    return_code: int
    stdout: str
    stderr: str

    @property
    def success(self):
        return self.return_code == 0

class CommandExecutor:

    ALLOWED_COMMANDS = {
        "npm",
        "npx",
        "node",
    }

    def __init__(self, workspace_manager):
        self.workspace = workspace_manager

    def validate_command(
        self,
        command: list[str],
    ):

        if not command:
            raise InvalidCommandError(
                "Command cannot be empty."
            )

        executable = command[0]

        if executable not in self.ALLOWED_COMMANDS:
            raise InvalidCommandError(
                f"Command not allowed: {executable}"
            )

    def run(
        self,
        command: list[str],
        cwd: str = "",
        timeout: int = 120,
    ) -> CommandResult:

        self.workspace.ensure_exists()

        self.validate_command(command)

        working_directory = (
            self.workspace.resolve_path(cwd)
            if cwd
            else self.workspace.workspace_path
        )

        if not working_directory.exists():
            raise FileNotFoundError(
                working_directory
            )

        if not working_directory.is_dir():
            raise NotADirectoryError(
                working_directory
            )

        executable = shutil.which(command[0])

        if executable is None:
            raise FileNotFoundError(
                f"Executable not found: {command[0]}"
            )

        resolved_command = [
            executable,
            *command[1:],
        ]

        try:
            process = subprocess.run(
                resolved_command,
                cwd=working_directory,
                capture_output=True,
                text=True,
                timeout=timeout,
                shell=False,
            )

        except subprocess.TimeoutExpired as exc:
            raise CommandTimeoutError(
                f"Command timed out after "
                f"{timeout} seconds."
            ) from exc

        return CommandResult(
            command=command,
            return_code=process.returncode,
            stdout=process.stdout,
            stderr=process.stderr,
        )