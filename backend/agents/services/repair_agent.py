import json

from agents.prompts.repair import (
    REPAIR_SYSTEM_PROMPT,
)

from agents.providers.factory import (
    get_llm_provider,
)

from agents.schemas.repair import (
    RepairResult,
)


class RepairAgentService:

    MAX_ATTEMPTS = 3

    def __init__(self):
        self.llm = get_llm_provider()

    
    def repair(
        self,
        *,
        application_specification: dict,
        task: dict,
        errors: list[str],
        file_tree: list[str],
        relevant_files: dict[str, str],
    ) -> RepairResult:
        payload = {
            "application_specification": application_specification,
            "task": task,
            "validation_errors": errors,
            "project_file_tree": file_tree,
            "relevant_files": relevant_files,
        }

        previous_error = None
        error_history = []

        for attempt in range(1, self.MAX_ATTEMPTS + 1):
            try:
                result = self._generate(
                    payload,
                    previous_error=previous_error,
                )
                return result

            except ValueError as exc:
                current_error = str(exc)
                error_history.append(current_error)

                if (
                    len(error_history) >= 2
                    and error_history[-1] == error_history[-2]
                ):
                    previous_error = (
                        "The previous repair produced the same failure again. "
                        "Do not repeat the same solution. Reassess the root cause.\n\n"
                        f"Repeated error:\n{current_error}"
                    )
                else:
                    previous_error = current_error

        raise ValueError(
            f"Repair generation failed after {self.MAX_ATTEMPTS} attempts. "
            f"Errors: {error_history}"
        )


    def _generate(
        self,
        payload: dict,
        previous_error: str | None = None,
    ) -> RepairResult:

        messages = [
            {
                "role": "system",
                "content": REPAIR_SYSTEM_PROMPT,
            },
            {
                "role": "user",
                "content": json.dumps(
                    payload,
                    indent=2,
                ),
            },
        ]

        if previous_error:
            messages.append(
                {
                    "role": "user",
                    "content": (
                        "Your previous repair "
                        "was rejected.\n\n"
                        f"Reason:\n"
                        f"{previous_error[:3000]}"
                        "\n\n"
                        "Generate a corrected repair.\n\n"
                        "STRICT RULES:\n"
                        "- Allowed operations are ONLY "
                        '"write_file" and '
                        '"delete_file".\n'
                        '- NEVER use "modify_file". '
                        "Use write_file with the "
                        "complete final contents.\n"
                        "- Only modify files listed "
                        "in the current task's "
                        "files array.\n"
                        "- Do NOT modify Prisma "
                        "configuration.\n"
                        "- Do NOT modify package.json "
                        "or tsconfig.json.\n"
                        "- Do NOT import PrismaClient "
                        "from @prisma/client.\n"
                        "- Do NOT instantiate "
                        "PrismaClient.\n"
                        '- Do NOT use "@/..." '
                        "imports.\n"
                        "- Reuse the existing shared "
                        "Prisma instance.\n"
                        "- Return ONLY valid JSON."
                    ),
                }
            )

        response = self.llm.generate(
            messages,
            temperature=0.1,
            json_schema=(RepairResult.model_json_schema()),
        )

        if not response.content or not response.content.strip():
            raise ValueError("Repair agent returned " "an empty response.")

        data = self._parse_json(response.content)
        data = self._normalize_operations(data)

        try:
            result = RepairResult.model_validate(data)

        except Exception as exc:
            raise ValueError(
                "Repair JSON did not match "
                "RepairResult schema.\n"
                f"Validation error: {exc}\n\n"
                f"Raw response:\n"
                f"{response.content[:4000]}"
            ) from exc

        self._validate_generated_architecture(
            result,
            task=payload.get(
                "task",
                {},
            ),
        )

        return result

    def _normalize_operations(
        self,
        data: dict,
    ) -> dict:

        operations = data.get(
            "operations",
            [],
        )

        if not isinstance(
            operations,
            list,
        ):
            return data

        for operation in operations:

            if not isinstance(
                operation,
                dict,
            ):
                continue

            if operation.get("operation") == "modify_file":
                operation["operation"] = "write_file"

        return data

    def _parse_json(
        self,
        content: str,
    ) -> dict:

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
                "Repair agent returned " "invalid JSON.\n\n" f"Raw output:\n{content}"
            ) from exc

        if not isinstance(
            data,
            dict,
        ):
            raise ValueError("Repair output must " "be a JSON object.")

        return data

    
    def _fix_client_directive(self, content: str) -> str:
        lines = content.splitlines()

        if not lines:
            return content

        first = lines[0].strip()

        if first in {"use client", "use client;"}:
            lines[0] = "'use client';"
            return "\n".join(lines) + ("\n" if content.endswith("\n") else "")

        return content

    
    def _validate_generated_architecture(
        self,
        result: RepairResult,
        *,
        task: dict,
    ) -> None:
        violations: list[str] = []

        allowed_paths = set(task.get("files", []))

        protected_paths = {
            "backend/src/config/prisma.ts",
            "backend/src/config/prisma.js",
            "backend/prisma.config.ts",
            "backend/tsconfig.json",
            "backend/package.json",
        }

        client_hooks = [
            "useState",
            "useEffect",
            "useReducer",
            "useRef",
            "useContext",
            "useLayoutEffect",
        ]

        for operation in result.operations:
            path = operation.path
            content = operation.content or ""

            # Check protected infrastructure and task scope.
            if path in protected_paths:
                violations.append(
                    f"{path}: repair agent cannot modify protected infrastructure."
                )

            if allowed_paths and path not in allowed_paths:
                violations.append(
                    f"{path}: file is outside the current task scope. "
                    f"Allowed files: {sorted(allowed_paths)}"
                )

            # Only file contents can be checked below.
            if operation.operation != "write_file":
                continue

            # Prevent modifications to generated or installed files.
            if (
                path.startswith("frontend/node_modules/")
                or path.startswith("backend/node_modules/")
            ):
                violations.append(
                    f"{path}: repair must not modify node_modules."
                )

            if "/.next/" in path:
                violations.append(
                    f"{path}: repair must not modify .next."
                )

            if "/dist/" in path:
                violations.append(
                    f"{path}: repair must not modify compiled dist files."
                )

            # -----------------------------------------
            # Frontend architecture validation
            # -----------------------------------------
            if path.startswith("frontend/"):
                uses_client_hook = any(
                    hook in content for hook in client_hooks
                )

                stripped_content = content.lstrip()

                valid_client_directive = (
                    stripped_content.startswith('"use client";')
                    or stripped_content.startswith("'use client';")
                    or stripped_content.startswith('"use client"')
                    or stripped_content.startswith("'use client'")
                )

                if uses_client_hook and not valid_client_directive:
                    violations.append(
                        f"{path}: React client hooks are used, so the file "
                        'must begin with "use client"; or \'use client\';'
                    )

                if path.startswith("frontend/pages/") or "/pages/" in path:
                    violations.append(
                        f"{path}: Pages Router is forbidden. "
                        "Use frontend/app/ with App Router."
                    )

                if path.endswith("page.tsx") and not path.startswith("frontend/app/"):
                    violations.append(
                        f"{path}: Next.js pages must live under frontend/app/."
                    )

                if 'from "@/' in content:
                    violations.append(
                        f"{path}: @/ aliases are forbidden unless explicitly configured."
                    )

                if "backend/src/" in content:
                    violations.append(
                        f"{path}: frontend source must not import backend source files."
                    )

                # Do not apply backend rules to frontend files.
                continue

            # Ignore files outside backend source for backend-specific checks.
            if not path.startswith("backend/src/"):
                continue

            # -----------------------------------------
            # Backend architecture validation
            # -----------------------------------------
            normalized = content.replace("'", '"')

            if (
                '"@prisma/client"' in normalized
                and "PrismaClient" in normalized
            ):
                violations.append(
                    f"{path}: importing PrismaClient from @prisma/client is forbidden."
                )

            if "new PrismaClient(" in content:
                violations.append(
                    f"{path}: new PrismaClient() is forbidden."
                )

            if 'from "@/' in normalized:
                violations.append(
                    f"{path}: @/ imports are forbidden."
                )

            if "generated/prisma/models/" in content:
                violations.append(
                    f"{path}: importing individual generated Prisma model files "
                    "is forbidden."
                )

        if violations:
            raise ValueError(
                "ARCHITECTURE_VIOLATION:\n" + "\n".join(violations)
            )
