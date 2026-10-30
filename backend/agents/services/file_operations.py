from agents.schemas.code_generation import (
    CodeGenerationResult,
)

from workspaces.manager import (
    WorkspaceManager,
)


class FileOperationService:

    FORBIDDEN_PARTS = {
        "node_modules",
        ".next",
        ".git",
        "dist",
        "build",
    }

    @staticmethod
    def apply(
        *,
        workspace: WorkspaceManager,
        result: CodeGenerationResult,
    ) -> list[str]:

        changed_files = []

        for operation in result.operations:

            FileOperationService._validate_path(
                operation.path
            )

            if operation.operation == "write_file":

                if operation.content is None:
                    raise ValueError(
                        "write_file requires content."
                    )

                workspace.write_file(
                    operation.path,
                    operation.content,
                )

                changed_files.append(
                    operation.path
                )

            elif operation.operation == "delete_file":

                workspace.delete_file(
                    operation.path
                )

                changed_files.append(
                    operation.path
                )

        return changed_files

    @staticmethod
    def _validate_path(
        path: str,
    ) -> None:

        normalized = path.replace(
            "\\",
            "/",
        )

        if normalized.startswith("/"):
            raise ValueError(
                "Absolute paths are forbidden."
            )

        parts = [
            part
            for part in normalized.split("/")
            if part
        ]

        if ".." in parts:
            raise ValueError(
                "Path traversal is forbidden."
            )

        if any(
            part in FileOperationService.FORBIDDEN_PARTS
            for part in parts
        ):
            raise ValueError(
                f"Forbidden generated path: {path}"
            )