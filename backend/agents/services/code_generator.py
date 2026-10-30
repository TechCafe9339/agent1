import json
import re

from agents.prompts.code_generator import (
    CODE_GENERATOR_SYSTEM_PROMPT,
    FRONTEND_PAGE_GENERATION_RULES,
)
from agents.providers.factory import get_llm_provider
from agents.schemas.code_generation import CodeGenerationResult


class CodeGeneratorService:
    MAX_ATTEMPTS = 3
    MAX_ATTEMPTS_FRONTEND = 2
    MAX_ATTEMPTS_FULL_STACK = MAX_ATTEMPTS
    FRONTEND_PAGE = "frontend_page"
    FULL_STACK = "full_stack"

    def __init__(self):
        self.llm = get_llm_provider()

    def generate(
        self,
        *,
        task,
        application_specification: dict,
        file_tree: list[str],
        relevant_files: dict[str, str],
        generation_mode: str = FRONTEND_PAGE,
    ) -> CodeGenerationResult:
        if generation_mode not in {self.FRONTEND_PAGE, self.FULL_STACK}:
            raise ValueError(f"Unsupported generation mode: {generation_mode}")

        payload = {
            "generation_mode": generation_mode,
            "application_specification": application_specification,
            "task": {
                "id": task.id,
                "task_number": task.task_number,
                "type": task.task_type,
                "title": task.title,
                "description": task.description,
                "files": task.files,
                "dependencies": task.dependencies,
            },
            "project_file_tree": file_tree,
            "relevant_files": relevant_files,
        }

        
        max_attempts = (
            self.MAX_ATTEMPTS_FRONTEND
            if generation_mode == self.FRONTEND_PAGE
            else self.MAX_ATTEMPTS_FULL_STACK
        )

        last_error: Exception | None = None

        for _ in range(max_attempts):
            try:
                return self._generate(
                    payload,
                    previous_error=str(last_error) if last_error else None,
                )
            except ValueError as exc:
                last_error = exc

        raise ValueError(
            f"Code generation failed after {max_attempts} attempts. "
            f"Last error: {last_error}"
        ) from last_error

    def _generate(
        self,
        payload: dict,
        previous_error: str | None = None,
    ) -> CodeGenerationResult:
        generation_mode = payload.get("generation_mode", self.FRONTEND_PAGE)

        if generation_mode == self.FRONTEND_PAGE:
            system_prompt = (
                CODE_GENERATOR_SYSTEM_PROMPT + "\n\n" + FRONTEND_PAGE_GENERATION_RULES
            )
        elif generation_mode == self.FULL_STACK:
            system_prompt = CODE_GENERATOR_SYSTEM_PROMPT
        else:
            raise ValueError(f"Unsupported generation mode: {generation_mode}")

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(payload, indent=2)},
        ]

        if previous_error:
            if generation_mode == self.FRONTEND_PAGE:
                retry_instructions = f"""
Your previous output was rejected.

Reason:
{previous_error[:3000]}

Regenerate the task correctly.

STRICT REQUIREMENTS:
- Return ONLY valid JSON matching CodeGenerationResult.
- "summary" MUST be a string.
- "operations" MUST be an array.
- Every write_file operation must include "operation", "path", and "content".
- Use only files listed in task["files"].
- Include CSS files or stylesheet updates needed for the requested design.
- Do not create backend, database, Prisma, or Express files.
- Follow the existing Next.js App Router structure and actual project paths.
- Use valid TypeScript, React, and CSS.
- Ensure stylesheet imports point to files that exist or are created in this task.
- Do not return an empty operations array when task files require implementation.
- Write every required new task file.
- Return only JSON; do not use Markdown fences.
"""
            else:
                retry_instructions = f"""
Your previous output was rejected.

Reason:
{previous_error[:3000]}

Regenerate the task correctly.

STRICT REQUIREMENTS:
- Return ONLY valid JSON matching CodeGenerationResult.
- "summary" MUST be a string.
- "operations" MUST be an array.
- Every write_file operation must include "operation", "path", and "content".
- Use only files listed in task["files"].
- Reuse existing project files and conventions.
- Do not instantiate PrismaClient directly; reuse the shared Prisma instance.
- Relative NodeNext imports must include .js where required.
- Write every required new task file.
- Return only JSON; do not use Markdown fences.
"""
            messages.append({"role": "user", "content": retry_instructions})

        response = self.llm.generate(
            messages,
            temperature=0.1,
            json_schema=CodeGenerationResult.model_json_schema(),
        )

        if not response.content or not response.content.strip():
            raise ValueError("Code generator returned an empty response.")

        data = self._parse_json(response.content)
        try:
            result = CodeGenerationResult.model_validate(data)
        except Exception as exc:
            raise ValueError(
                "Generated JSON did not match CodeGenerationResult schema.\n"
                f"Validation error: {exc}\n\n"
                f"Raw response:\n{response.content[:4000]}"
            ) from exc

        for operation in result.operations:
            if operation.operation != "write_file":
                continue
            operation.content = self._normalize_client_directive(
                operation.path,
                operation.content or "",
            )

        self._validate_generated_architecture(
            result,
            generation_mode=generation_mode,
            allowed_paths=set(payload["task"]["files"]),
            existing_paths=set(payload["project_file_tree"]),
        )
        return result

    @staticmethod
    def _parse_json(content: str) -> dict:
        cleaned = content.strip()
        if cleaned.startswith("```json"):
            cleaned = cleaned[7:]
        elif cleaned.startswith("```"):
            cleaned = cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        cleaned = cleaned.strip()

        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError as exc:
            raise ValueError(
                "Qwen returned invalid code-generation JSON.\n\n"
                f"Raw output:\n{content[:6000]}"
            ) from exc

        if not isinstance(data, dict):
            raise ValueError("Code-generation output must be a JSON object.")
        return data

    @staticmethod
    def _normalize_path(path: str) -> str:
        path = path.strip().replace("\\", "/")

        while path.startswith("./"):
            path = path[2:]

        path = path.rstrip("/")

        if not path:
            raise ValueError("Generated file path cannot be empty.")

        parts = path.split("/")

        if (
            path.startswith("/")
            or any(part in {"", ".", ".."} for part in parts)
            or (parts and ":" in parts[0])
        ):
            raise ValueError(f"Unsafe generated file path: {path!r}")

        return path

    @classmethod
    def _is_frontend_path(cls, path: str) -> bool:
        path = cls._normalize_path(path)
        if path.startswith("frontend/"):
            return True
        return path.startswith(
            (
                "app/",
                "src/app/",
                "components/",
                "src/components/",
                "public/",
                "styles/",
                "src/styles/",
            )
        ) or path in {
            "package.json",
            "package-lock.json",
            "pnpm-lock.yaml",
            "yarn.lock",
            "tsconfig.json",
            "next.config.js",
            "next.config.mjs",
            "next.config.ts",
            "postcss.config.js",
            "postcss.config.mjs",
            "eslint.config.mjs",
        }

    @classmethod
    def _is_app_tsx_path(cls, path: str) -> bool:
        path = cls._normalize_path(path)
        return path.startswith(("frontend/app/", "app/", "src/app/")) and path.endswith(
            (".tsx", ".jsx")
        )

    def _validate_frontend_runtime(self, path: str, content: str) -> list[str]:
        violations: list[str] = []
        if not self._is_frontend_path(path):
            return violations

        client_hooks = (
            "useState",
            "useEffect",
            "useReducer",
            "useRef",
            "useContext",
            "useLayoutEffect",
        )
        uses_client_hooks = any(
            re.search(rf"\b{hook}\b", content) for hook in client_hooks
        )

        if uses_client_hooks:
            stripped = content.lstrip("\ufeff \t\r\n")
            valid_directive = (
                stripped.startswith("'use client';")
                or stripped.startswith('"use client";')
                or stripped.startswith("'use client'\n")
                or stripped.startswith('"use client"\n')
            )
            if not valid_directive:
                violations.append(
                    f"{path}: React client hooks are used, but the file does not "
                    "begin with a valid quoted 'use client' directive."
                )

        unsafe_storage_initializer = re.search(
            r"\buseState\s*\(.*?\b(?:localStorage|sessionStorage)\b",
            content,
            re.DOTALL,
        )
        if unsafe_storage_initializer:
            violations.append(
                f"{path}: localStorage/sessionStorage must not be accessed inside "
                "a useState initializer. Use a server-safe default and restore "
                "storage inside useEffect."
            )
        return violations

    def _normalize_client_directive(self, path: str, content: str) -> str:
        if not self._is_app_tsx_path(path):
            return content

        client_features = (
            "useState",
            "useEffect",
            "useReducer",
            "useRef",
            "useCallback",
            "useMemo",
            "useContext",
            "useLayoutEffect",
            "localStorage",
            "sessionStorage",
        )
        uses_client_features = any(
            re.search(rf"\b{re.escape(feature)}\b", content)
            for feature in client_features
        )

        uses_event_handlers = bool(
            re.search(
                r"\bon(?:Click|Change|Submit|Input|KeyDown|KeyUp|"
                r"MouseEnter|MouseLeave|Focus|Blur)\s*=",
                content,
            )
        )
        if not (uses_client_features or uses_event_handlers):
            return content

        # if not any(feature in content for feature in client_features):
        #     return content

        stripped = content.lstrip("\ufeff \t\r\n")
        if (
            stripped.startswith("'use client';")
            or stripped.startswith('"use client";')
            or stripped.startswith("'use client'")
            or stripped.startswith('"use client"')
        ):
            return content

        lines = content.splitlines(keepends=True)
        if lines and lines[0].strip() in {"use client", "use client;"}:
            newline = "\n" if lines[0].endswith(("\n", "\r")) else ""
            lines[0] = "'use client';" + newline
            return "".join(lines)

        return "'use client';\n\n" + content.lstrip("\ufeff \t\r\n")

    def _validate_generated_architecture(
        self,
        result: CodeGenerationResult,
        *,
        generation_mode: str,
        allowed_paths: set[str],
        existing_paths: set[str],
    ) -> None:
        violations: list[str] = []
        normalize_path = self._normalize_path
        normalized_allowed_paths = {normalize_path(p) for p in allowed_paths}
        normalized_existing_paths = {normalize_path(p) for p in existing_paths}
        generated_paths: set[str] = set()
        write_operations = []

        for operation in result.operations:
            path = normalize_path(operation.path)
            if path not in normalized_allowed_paths:
                violations.append(
                    f"{path}: file is outside the current task scope. "
                    f"Allowed files: {sorted(normalized_allowed_paths)}"
                )
                continue

            if operation.operation != "write_file":
                continue

            generated_paths.add(path)
            write_operations.append(operation)
            content = operation.content or ""
            violations.extend(self._validate_placeholder_content(path, content))
            normalized_content = content.replace("'", '"')

            if generation_mode == self.FULL_STACK and path.startswith("backend/src/"):
                relative_imports = re.findall(
                    r"""from\s+["'](\.{1,2}/[^"']+)["']""",
                    content,
                )
                for import_path in relative_imports:
                    if import_path.endswith(".ts"):
                        violations.append(
                            f"{path}: relative NodeNext import {import_path!r} "
                            "must not end in .ts; use the emitted .js extension."
                        )
                    elif not (
                        import_path.endswith(".js") or import_path.endswith(".json")
                    ):
                        violations.append(
                            f"{path}: relative NodeNext import {import_path!r} "
                            "must include the .js extension."
                        )

                if (
                    '"@prisma/client"' in normalized_content
                    and "PrismaClient" in normalized_content
                ):
                    violations.append(
                        f"{path}: importing PrismaClient from @prisma/client is "
                        "forbidden; reuse the shared Prisma instance."
                    )
                if "new PrismaClient(" in content:
                    violations.append(f"{path}: new PrismaClient() is forbidden.")
                if 'from "@/' in normalized_content:
                    violations.append(
                        f"{path}: @/ path aliases are forbidden in backend source."
                    )
                if "generated/prisma/models/" in content:
                    violations.append(
                        f"{path}: importing individual generated Prisma model files is forbidden."
                    )
                if "backend/src/generated/prisma" in content:
                    violations.append(
                        f"{path}: do not import Prisma using project-root absolute-style paths."
                    )

            if self._is_frontend_path(path):
                violations.extend(self._validate_frontend_runtime(path, content))

                if path.startswith(("frontend/pages/", "pages/")) or "/pages/" in path:
                    violations.append(
                        f"{path}: Pages Router paths are forbidden; use Next.js App Router."
                    )

                if 'from "@/' in normalized_content:
                    violations.append(
                        f"{path}: @/ aliases must only be used when configured in the existing project."
                    )

                if "backend/src/" in content:
                    violations.append(
                        f"{path}: frontend source must not import backend source files directly."
                    )

                if path.endswith(("page.tsx", "page.jsx")) and not path.startswith(
                    ("frontend/app/", "app/", "src/app/")
                ):
                    violations.append(
                        f"{path}: Next.js App Router pages must live under app/ or src/app/."
                    )

            if generation_mode == self.FRONTEND_PAGE and path.startswith(
                ("backend/", "server/", "prisma/")
            ):
                violations.append(
                    f"{path}: frontend_page mode cannot generate backend or database files."
                )

            if path.startswith(
                ("frontend/node_modules/", "backend/node_modules/", "node_modules/")
            ):
                violations.append(
                    f"{path}: generated code must not modify node_modules."
                )
            if "/.next/" in f"/{path}/" or path.startswith(".next/"):
                violations.append(f"{path}: generated code must not modify .next.")
            if "/dist/" in f"/{path}/" or path.startswith("dist/"):
                violations.append(
                    f"{path}: generated code must not write compiled dist files."
                )

        required_new_files = normalized_allowed_paths - normalized_existing_paths
        missing_required_files = required_new_files - generated_paths
        if missing_required_files:
            violations.append(
                "Generator did not create required new task files. "
                f"Missing: {sorted(missing_required_files)}"
            )

        if violations:
            raise ValueError("ARCHITECTURE_VIOLATION:\n" + "\n".join(violations))

        if not write_operations:
            raise ValueError(
                "ARCHITECTURE_VIOLATION:\n"
                "Generator returned no write_file operations for the current task."
            )

    @staticmethod
    def _validate_placeholder_content(path: str, content: str) -> list[str]:
        violations: list[str] = []
        placeholder_patterns = [
            r"existing file content would go here",
            r"implementation goes here",
            r"implement this later",
            r"add your code here",
            r"todo:\s*implement",
            r"placeholder implementation",
            r"rest of the code goes here",
        ]
        for pattern in placeholder_patterns:
            if re.search(pattern, content, re.IGNORECASE):
                violations.append(
                    f"{path}: generated file contains placeholder text matching "
                    f"{pattern!r}. Replace it with a real implementation."
                )
        return violations
