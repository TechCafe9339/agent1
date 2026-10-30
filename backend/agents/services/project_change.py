import json
import re
from pathlib import Path

from django.conf import settings

from agents.providers.factory import (
    get_llm_provider,
)


class ProjectChangeService:

    MAX_FILE_SIZE = 120_000

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
        ).resolve()

    def _safe_path(
        self,
        root: Path,
        relative_path: str,
    ) -> Path:
        target = (root / relative_path).resolve()

        try:
            target.relative_to(root)

        except ValueError:
            raise ValueError(f"Unsafe project path: {relative_path}")

        return target

    def _read_existing_files(
        self,
        *,
        project,
        paths: list[str],
    ) -> list[dict]:
        root = self._workspace_root(project)

        files = []

        for relative_path in paths:
            path = self._safe_path(
                root,
                relative_path,
            )

            if not path.exists() or not path.is_file():
                continue

            if path.stat().st_size > self.MAX_FILE_SIZE:
                continue

            try:
                content = path.read_text(encoding="utf-8")

            except UnicodeDecodeError:
                continue

            files.append(
                {
                    "path": relative_path,
                    "content": content,
                }
            )

        return files

    def apply(
        self,
        *,
        project,
        change_request: str,
        affected_files: list[str],
        new_files: list[str],
    ) -> dict:

        root = self._workspace_root(project)

        existing_paths = {
            path.relative_to(root).as_posix()
            for path in root.rglob("*")
            if path.is_file()
            and not any(
                part in {"node_modules", ".next", ".git", "dist"}
                for part in path.relative_to(root).parts
            )
        }

        invalid_affected = set(affected_files) - existing_paths

        if invalid_affected:
            raise ValueError(
                f"Unknown existing project files: {sorted(invalid_affected)}"
            )

        conflicting_new = set(new_files) & existing_paths

        if conflicting_new:
            raise ValueError(
                "New-file paths already exist. Use the existing files instead: "
                f"{sorted(conflicting_new)}"
            )

        allowed_paths = set(affected_files) | set(new_files)
        existing_files = self._read_existing_files(
            project=project,
            paths=affected_files,
        )

        schema = {
            "type": "object",
            "properties": {
                "summary": {
                    "type": "string",
                },
                "files": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "path": {
                                "type": "string",
                            },
                            "content": {
                                "type": "string",
                            },
                        },
                        "required": [
                            "path",
                            "content",
                        ],
                        "additionalProperties": False,
                    },
                },
            },
            "required": [
                "summary",
                "files",
            ],
            "additionalProperties": False,
        }

        source_text = "\n\n".join(
            (f"FILE: {item['path']}\n" f"```text\n" f"{item['content']}\n" f"```")
            for item in existing_files
        )

        messages = [
            {
                "role": "system",
                "content": """
You are the code modification engine for Prompt2Web.

Modify the existing generated web application directly.

GENERAL RULES:
- Return only files that must actually be written.
- Only modify explicitly allowed file paths.
- Preserve unrelated functionality.
- Return complete file contents.
- Use real newline characters in source files.
- Do not include Markdown fences inside file contents.
- Do not invent imports, dependencies, or file paths.
- Keep changes minimal and focused.
- Preserve existing authentication, routing, API integrations,
  business logic, and application state.

AUTONOMOUS UI MODIFICATION:
- Treat requests such as "apply styling", "make this page modern",
  and "improve the UI" as direct implementation tasks.
- Do not respond with instructions explaining how the user
  can write CSS. Implement the requested change.
- Inspect the supplied project tree and relevant source files.
- Reuse existing global styles, CSS Modules, design tokens,
  and the project's installed styling framework.
- Update existing stylesheets instead of creating duplicates.
- Create a stylesheet only when necessary.
- Ensure the root layout imports the correct stylesheet.
- For Next.js client components, use a valid "use client"
  directive only when client-side behavior requires it.
- Return complete, syntactically valid file contents.

VALIDATION:
- Check stylesheet imports and file paths.
- Preserve existing functionality.
- Run available build checks when supported.
- Never claim a build or preview succeeded without verification.
""",
            },
            {
                "role": "user",
                "content": f"""
PROJECT:
{project.name}

ORIGINAL REQUEST:
{project.initial_prompt}

REQUESTED CHANGE:
{change_request}

ALLOWED EXISTING FILES:
{affected_files}

ALLOWED NEW FILES:
{new_files}

CURRENT FILE CONTENTS:

{source_text}

Return the complete updated contents for every file
that must be written in order to implement the change.
""",
            },
        ]

        response = self.llm.generate(
            messages,
            temperature=0.1,
            json_schema=schema,
        )

        result = json.loads(response.content)
        if not isinstance(result.get("files"), list) or not result["files"]:
            raise ValueError(
                "The AI returned no files to modify. "
                "No project changes were applied."
            )

        written_files = []

        for file_result in result["files"]:
            relative_path = file_result["path"]

            if relative_path not in allowed_paths:
                raise ValueError(
                    (
                        "LLM attempted to modify "
                        "unauthorized file: "
                        f"{relative_path}"
                    )
                )

            target = self._safe_path(
                root,
                relative_path,
            )

            target.parent.mkdir(
                parents=True,
                exist_ok=True,
            )

            generated_content = self._normalize_generated_content(
                path=relative_path,
                content=file_result["content"],
            )

            self._validate_generated_content(
                path=relative_path,
                content=generated_content,
            )

            target.write_text(
                generated_content,
                encoding="utf-8",
            )

            written_files.append(relative_path)

        return {
            "summary": result["summary"],
            "written_files": written_files,
        }

    def _normalize_generated_content(
        self,
        *,
        path: str,
        content: str,
    ) -> str:

        code_extensions = (
            ".ts",
            ".tsx",
            ".js",
            ".jsx",
            ".css",
            ".json",
            ".html",
        )

        if path.endswith(code_extensions):
            literal_newlines = content.count("\\n")

            real_newlines = content.count("\n")

            # The model occasionally double-escapes
            # complete source files.
            if literal_newlines >= 2 and literal_newlines > real_newlines:
                content = (
                    content.replace(
                        "\\r\\n",
                        "\n",
                    )
                    .replace(
                        "\\n",
                        "\n",
                    )
                    .replace(
                        "\\t",
                        "\t",
                    )
                )

        if path.endswith(
            (
                ".tsx",
                ".jsx",
            )
        ):
            stripped = content.lstrip()

            invalid_starts = (
                "useClient",
                "use client",
                "'use client",
                '"use client',
            )

            if stripped.startswith(invalid_starts):
                lines = stripped.splitlines()

                if lines:
                    lines[0] = '"use client";'

                    content = "\n".join(lines)

        return content

    def _validate_generated_content(
        self,
        *,
        path: str,
        content: str,
    ):
        if path.endswith(
            (
                ".ts",
                ".tsx",
                ".js",
                ".jsx",
            )
        ):
            first_part = content[:500]

            if "\\n" in first_part:
                raise ValueError(
                    (
                        "Generated source contains "
                        "literal escaped newlines: "
                        f"{path}"
                    )
                )

            if path.endswith(
                (
                    ".tsx",
                    ".jsx",
                )
            ) and content.lstrip().startswith("useClient"):
                raise ValueError(("Invalid Next.js client " f"directive in {path}"))

            
            # Reject malformed side-effect imports that also
            # contain a second "from" clause.
            malformed_import = re.search(
                r"""(?m)^\s*import\s+(['"])[^'"\n]+\1\s+from\s+(['"])[^'"\n]+\2\s*;?""",
                content,
            )

            if malformed_import:
                raise ValueError(
                    "Malformed import statement detected in "
                    f"{path}: {malformed_import.group(0).strip()}"
                )

