import json
from pathlib import Path, PurePosixPath

from django.conf import settings

from agents.providers.factory import (
    get_llm_provider,
)


class ChangeImpactAnalyzer:

    MAX_FILES = 250

    def __init__(self):
        self.llm = get_llm_provider()

    def _workspace_root(
        self,
        project,
    ) -> Path:
        return (
            Path(settings.BASE_DIR).parent
            / "generated_workspaces"
            / f"project_{project.id}"
        )

    def _get_file_tree(
        self,
        project,
    ) -> list[str]:
        root = self._workspace_root(project)

        if not root.exists():
            return []

        ignored_directories = {
            "node_modules",
            ".next",
            "dist",
            ".git",
            "__pycache__",
            ".turbo",
        }

        ignored_files = {
            ".env",
            ".env.local",
            ".env.production",
            ".env.development",
        }

        files = []

        for path in root.rglob("*"):
            if len(files) >= self.MAX_FILES:
                break

            if not path.is_file():
                continue

            relative = path.relative_to(root)

            if any(part in ignored_directories for part in relative.parts):
                continue

            if path.name in ignored_files:
                continue

            if path.name.lower().startswith(".env."):
                continue

            files.append(relative.as_posix())

        return sorted(files)

    def analyze(
        self,
        *,
        project,
        change_request: str,
    ) -> dict:

        project_files = self._get_file_tree(project)
        stylesheet_context = self._get_stylesheet_context(project)

        schema = {
            "type": "object",
            "properties": {
                "summary": {
                    "type": "string",
                },
                "affected_files": {
                    "type": "array",
                    "items": {
                        "type": "string",
                    },
                },
                "new_files": {
                    "type": "array",
                    "items": {
                        "type": "string",
                    },
                },
                "risk": {
                    "type": "string",
                    "enum": [
                        "low",
                        "medium",
                        "high",
                    ],
                },
                "reason": {
                    "type": "string",
                },
            },
            "required": [
                "summary",
                "affected_files",
                "new_files",
                "risk",
                "reason",
            ],
            "additionalProperties": False,
        }

        files_text = "\n".join(project_files) if project_files else "No files found."

        messages = [
            {
                "role": "system",
                "content": """
You are the software change-impact analyzer for Prompt2Web.

Analyze the user's requested change against the actual project.

GENERAL RULES:
- affected_files must contain only existing paths from the
  supplied project file tree.
- new_files must contain only genuinely necessary new paths.
- Never invent existing files or dependencies.
- Keep changes minimal and preserve existing functionality.
- Return structured JSON only.

STYLING REQUESTS:
- Treat requests such as "apply styling", "improve the UI",
  and "make this page modern" as implementation tasks.
- Identify the target page and its relevant components.
- Inspect stylesheet_context to identify CSS files actually
  imported by the application's layout.
- Include the relevant page, imported stylesheet, and layout
  in affected_files when they need modification.
- Prefer updating an existing imported stylesheet.
- Include layout.tsx only when its imports or structure
  actually need to change.
- Do not propose duplicate stylesheets unnecessarily.
- Respect the framework and CSS conventions already used.
- Do not include unrelated backend files for frontend-only
  styling requests.

Return only structured JSON.
""",
            },
            {
                "role": "user",
                "content": f"""
PROJECT:
{project.name}

ORIGINAL REQUEST:
{project.initial_prompt}

CURRENT STATUS:
{project.status}

REQUESTED CHANGE:
{change_request}

EXISTING PROJECT FILES:
{files_text}

STYLESHEET CONTEXT:
{json.dumps(stylesheet_context, indent=2)}

When modifying styles:
- Prefer the stylesheet already imported by the application.
- Never create a duplicate root-level stylesheet when an existing
  imported stylesheet can be updated.
- Only create a new stylesheet when necessary, and update the
  relevant layout import if the new file must be connected.

Determine:
1. Which existing files are affected.
2. Which new files may be required.
3. Risk level.
4. Why those files are affected.
""",
            },
        ]

        response = self.llm.generate(
            messages,
            temperature=0,
            json_schema=schema,
        )

        result = json.loads(response.content)

        
        existing_files = set(project_files)

        # Validate existing files returned by the LLM.
        result["affected_files"] = [
            path
            for path in result["affected_files"]
            if path in existing_files
        ]

        # Validate new file paths returned by the LLM.

        validated_new_files = []

        for path in result["new_files"]:
            candidate = PurePosixPath(path)

            if (
                candidate.is_absolute()
                or not candidate.parts
                or ".." in candidate.parts
                or path in existing_files
                or "\\" in path
            ):
                continue

            validated_new_files.append(path)

        result["new_files"] = validated_new_files

        return result


    
    def _get_stylesheet_context(self, project) -> dict:
        import re
        from posixpath import normpath

        root = self._workspace_root(project).resolve()
        existing_files = set(self._get_file_tree(project))

        layout_candidates = [
            path
            for path in existing_files
            if path.endswith(("layout.tsx", "layout.jsx"))
        ]

        imported_stylesheets = set()

        for relative_path in layout_candidates:
            layout_path = (root / relative_path).resolve()

            try:
                layout_path.relative_to(root)
                content = layout_path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError, ValueError):
                continue

            for match in re.finditer(
                r"""import\s+["']([^"']+\.css)["']""",
                content,
            ):
                import_path = match.group(1)

                # Only resolve relative CSS imports.
                if not import_path.startswith("."):
                    continue

                resolved = normpath(
                    (
                        Path(relative_path).parent / import_path
                    ).as_posix()
                )

                if resolved.startswith("../"):
                    continue

                if resolved in existing_files:
                    imported_stylesheets.add(resolved)

        return {
            "existing_files": sorted(existing_files),
            "imported_stylesheets": sorted(imported_stylesheets),
        }
