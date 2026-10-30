import shutil
from pathlib import Path

from django.conf import settings


class TemplateManager:
    FULL_STACK_TEMPLATE = "next-express-mysql"
    FRONTEND_TEMPLATE = "nextjs-frontend"

    @classmethod
    def get_template_path(cls, template_name: str | None = None) -> Path:
        if template_name is None:
            template_name = cls.FULL_STACK_TEMPLATE

        templates_root = settings.BASE_DIR.parent / "templates"
        template_path = (templates_root / template_name).resolve()

        # Ensure the selected template remains inside the templates directory.
        templates_root = templates_root.resolve()

        try:
            template_path.relative_to(templates_root)
        except ValueError as exc:
            raise ValueError(
                f"Invalid template path: {template_name}"
            ) from exc

        if not template_path.is_dir():
            raise FileNotFoundError(
                f"Template directory not found: {template_path}"
            )

        return template_path

    @classmethod
    def get_template_for_mode(cls, generation_mode: str) -> str:
        if generation_mode == "frontend_page":
            return cls.FRONTEND_TEMPLATE

        if generation_mode == "full_stack":
            return cls.FULL_STACK_TEMPLATE

        raise ValueError(
            f"Unsupported generation mode: {generation_mode}"
        )

    @classmethod
    def copy_to_workspace(
        cls,
        workspace_path: Path,
        template_name: str | None = None,
    ) -> None:
        template_path = cls.get_template_path(template_name)

        for item in template_path.iterdir():
            destination = workspace_path / item.name

            if item.is_dir():
                shutil.copytree(item, destination, dirs_exist_ok=True)
            else:
                shutil.copy2(item, destination)
