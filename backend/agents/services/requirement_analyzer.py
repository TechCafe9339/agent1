
import json

from pydantic import ValidationError

from agents.prompts.requirements import (
    REQUIREMENT_ANALYZER_SYSTEM_PROMPT,
)
from agents.providers.factory import get_llm_provider
from agents.schemas.requirements import (
    ApplicationSpecification as ApplicationSpecificationSchema,
)
from projects.models import Project


class RequirementAnalyzer:
    MAX_ATTEMPTS = 3

    FRONTEND_PAGE = "frontend_page"
    FULL_STACK = "full_stack"

    def __init__(self):
        self.llm = get_llm_provider()

    def analyze(
        self,
        prompt: str,
        generation_mode: str = FRONTEND_PAGE,
    ) -> ApplicationSpecificationSchema:
        if not prompt or not prompt.strip():
            raise ValueError("The project prompt cannot be empty.")

        if generation_mode not in {
            self.FRONTEND_PAGE,
            self.FULL_STACK,
        }:
            raise ValueError(
                f"Unsupported generation mode: {generation_mode}"
            )

        last_error = None

        for _ in range(self.MAX_ATTEMPTS):
            try:
                return self._generate_specification(
                    prompt.strip(),
                    generation_mode,
                )
            except (ValueError, ValidationError) as exc:
                last_error = exc

        raise ValueError(
            f"Requirement analysis failed after {self.MAX_ATTEMPTS} attempts."
        ) from last_error

    def _generate_specification(
        self,
        prompt: str,
        generation_mode: str,
    ) -> ApplicationSpecificationSchema:
        user_payload = {
            "generation_mode": generation_mode,
            "user_prompt": prompt,
            "required_output_schema": {
                "name": "string",
                "description": "string",
                "application_type": "string",
                "stack": {
                    "frontend": "string",
                    "backend": "string",
                    "database": "string",
                    "orm": "string",
                    "language": "string",
                },
                "features": ["string"],
                "entities": [
                    {
                        "name": "string",
                        "description": "string",
                    }
                ],
                "pages": ["string"],
                "user_roles": ["string"],
                "assumptions": ["string"],
            },
        }

        response = self.llm.generate(
            [
                {
                    "role": "system",
                    "content": REQUIREMENT_ANALYZER_SYSTEM_PROMPT,
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        user_payload,
                        indent=2,
                    ),
                },
            ],
            temperature=0.1,
            json_mode=True,
        )

        if not response.content:
            raise ValueError(
                "The LLM returned an empty requirement specification."
            )

        data = self._parse_json(response.content)

        # Enforce the selected mode instead of relying solely on the LLM.
        data["application_type"] = (
            "frontend_page"
            if generation_mode == self.FRONTEND_PAGE
            else data.get("application_type", "web_application")
        )

        stack = data.get("stack")
        if not isinstance(stack, dict):
            raise ValueError(
                "The requirement specification must contain a stack object."
            )

        if generation_mode == self.FRONTEND_PAGE:
            stack.update({
                "frontend": "nextjs",
                "backend": "none",
                "database": "none",
                "orm": "none",
                "language": "typescript",
            })
        else:
            stack.setdefault("frontend", "nextjs")
            stack.setdefault("backend", "express")
            stack.setdefault("database", "none")
            stack.setdefault("orm", "none")
            stack.setdefault("language", "typescript")

        specification = ApplicationSpecificationSchema.model_validate(data)

        self._validate_stack(
            specification,
            generation_mode,
        )

        return specification

    def _parse_json(self, content: str) -> dict:
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
                "The LLM returned invalid requirement JSON."
            ) from exc

        if not isinstance(data, dict):
            raise ValueError(
                "The requirement specification must be a JSON object."
            )

        return data

    def _validate_stack(
        self,
        specification: ApplicationSpecificationSchema,
        generation_mode: str,
    ) -> None:
        stack = specification.stack

        if stack.frontend != "nextjs":
            raise ValueError(
                "The generated frontend must use Next.js."
            )

        if stack.language != "typescript":
            raise ValueError(
                "The generated frontend must use TypeScript."
            )

        if generation_mode == self.FRONTEND_PAGE:
            if (
                stack.backend != "none"
                or stack.database != "none"
                or stack.orm != "none"
            ):
                raise ValueError(
                    "Frontend-page mode cannot require a backend, "
                    "database, or ORM."
                )
            return

        if stack.backend not in {"express", "none"}:
            raise ValueError(
                "Full-stack mode supports Express or no backend."
            )

        if stack.database == "mysql" and stack.orm != "prisma":
            raise ValueError(
                "MySQL projects must use Prisma."
            )

        if stack.database == "none" and stack.orm != "none":
            raise ValueError(
                "A project without a database cannot require an ORM."
            )
