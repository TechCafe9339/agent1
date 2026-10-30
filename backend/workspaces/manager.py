import json
import shutil
from pathlib import Path

from django.conf import settings

from .templates import TemplateManager
from .exceptions import (
    WorkspaceAlreadyExistsError,
    WorkspaceNotFoundError,
    InvalidWorkspacePathError,
)


class WorkspaceManager:
    IGNORED_DIRECTORIES = {
        "node_modules",
        ".next",
        ".git",
        "dist",
        "build",
        "__pycache__",
    }

    
    
    def __init__(self, project):
        from django.utils.text import slugify

        self.project = project
        self.root = Path(settings.WORKSPACE_ROOT).resolve()

        folder_name = slugify(project.name).replace("-", "_")
        self.workspace_path = (self.root / folder_name).resolve()

        try:
            self.workspace_path.relative_to(self.root)
        except ValueError as exc:
            raise InvalidWorkspacePathError(
                f"Invalid workspace path for project {project.id}"
            ) from exc

    @property
    def generation_mode(self) -> str:
        return getattr(
            self.project,
            "generation_mode",
            "full_stack",
        )

    @property
    def is_frontend_only(self) -> bool:
        return self.generation_mode == "frontend_page"

    
    def resolve_path(self, relative_path: str) -> Path:
        if not relative_path or not relative_path.strip():
            raise InvalidWorkspacePathError(
                "Workspace path cannot be empty."
            )

        relative = Path(relative_path)

        if relative.is_absolute():
            raise InvalidWorkspacePathError(
                f"Absolute paths are not allowed: {relative_path}"
            )

        target = (self.workspace_path / relative).resolve()

        try:
            target.relative_to(self.workspace_path)
        except ValueError as exc:
            raise InvalidWorkspacePathError(
                f"Path escapes workspace: {relative_path}"
            ) from exc

        return target


    def exists(self) -> bool:
        return self.workspace_path.exists()

    def ensure_exists(self):
        if not self.exists():
            raise WorkspaceNotFoundError(
                f"Workspace not found for project {self.project.id}"
            )

    def create(self):
        if self.exists():
            raise WorkspaceAlreadyExistsError(
                f"Workspace already exists: {self.workspace_path}"
            )

        self.workspace_path.mkdir(
            parents=True,
            exist_ok=False,
        )

        try:
            template_name = TemplateManager.get_template_for_mode(self.generation_mode)

            TemplateManager.copy_to_workspace(
                self.workspace_path,
                template_name=template_name,
            )

            if not self.is_frontend_only:
                self._setup_backend_env()

            builder_directory = self.resolve_path(".builder")
            builder_directory.mkdir(
                parents=True,
                exist_ok=True,
            )

            self._create_project_manifest()

        except Exception:
            # Avoid leaving a partially initialized workspace behind.
            shutil.rmtree(self.workspace_path, ignore_errors=True)
            raise

        return self.workspace_path

    def _setup_backend_env(self):
        example_file = self.resolve_path("backend/.env.example")
        env_file = self.resolve_path("backend/.env")

        if env_file.exists():
            return

        if example_file.is_file():
            shutil.copy2(example_file, env_file)

    def _create_project_manifest(self):
        if self.is_frontend_only:
            stack = {
                "frontend": "nextjs",
                "backend": "none",
                "database": "none",
                "orm": "none",
                "language": "typescript",
            }
        else:
            stack = {
                "frontend": "nextjs",
                "backend": "express",
                "database": "mysql",
                "orm": "prisma",
                "language": "typescript",
            }

        manifest = {
            "project_id": self.project.id,
            "name": self.project.name,
            "generation_mode": self.generation_mode,
            "stack": stack,
            "status": "initialized",
        }

        manifest_path = self.resolve_path("project.json")
        manifest_path.write_text(
            json.dumps(manifest, indent=2),
            encoding="utf-8",
        )

    def write_file(
        self,
        relative_path: str,
        content: str,
    ):
        self.ensure_exists()

        file_path = self.resolve_path(relative_path)
        file_path.parent.mkdir(
            parents=True,
            exist_ok=True,
        )
        file_path.write_text(content, encoding="utf-8")

        return file_path

    def read_file(self, relative_path: str) -> str:
        self.ensure_exists()

        file_path = self.resolve_path(relative_path)

        if not file_path.exists():
            raise FileNotFoundError(relative_path)

        if not file_path.is_file():
            raise IsADirectoryError(relative_path)

        return file_path.read_text(encoding="utf-8")

    def delete_file(self, relative_path: str):
        self.ensure_exists()

        file_path = self.resolve_path(relative_path)

        if not file_path.exists():
            raise FileNotFoundError(relative_path)

        if not file_path.is_file():
            raise IsADirectoryError(relative_path)

        file_path.unlink()

    def list_files(self):
        self.ensure_exists()

        files = []

        for path in self.workspace_path.rglob("*"):
            relative = path.relative_to(self.workspace_path)

            if any(part in self.IGNORED_DIRECTORIES for part in relative.parts):
                continue

            if path.is_file():
                files.append(relative.as_posix())

        return sorted(files)
