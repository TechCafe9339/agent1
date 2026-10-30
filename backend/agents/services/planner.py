import json

from pydantic import ValidationError

from agents.prompts.planner import PLANNER_SYSTEM_PROMPT
from agents.providers.factory import get_llm_provider
from agents.schemas.plan import ImplementationPlan
from projects.models import ApplicationSpecification


class PlannerService:
    MAX_ATTEMPTS = 2

    FRONTEND_PAGE = "frontend_page"
    FULL_STACK = "full_stack"

    FRONTEND_PAGE_TASK_TYPES = {"frontend", "build"}
    MAX_FRONTEND_TASKS = 5

    def __init__(self):
        self.llm = get_llm_provider()

    def create_plan(
        self,
        specification: ApplicationSpecification,
        generation_mode: str = FRONTEND_PAGE,
    ) -> ImplementationPlan:
        if generation_mode not in {
            self.FRONTEND_PAGE,
            self.FULL_STACK,
        }:
            raise ValueError(f"Unsupported generation mode: {generation_mode}")

        payload = {
            "generation_mode": generation_mode,
            "name": specification.name,
            "description": specification.description,
            "application_type": specification.application_type,
            "stack": specification.stack,
            "features": specification.features,
            "entities": specification.entities,
            "pages": specification.pages,
            "user_roles": specification.user_roles,
            "assumptions": specification.assumptions,
        }

        last_error = None

        for _ in range(self.MAX_ATTEMPTS):
            try:
                return self._generate_plan(
                    payload,
                    generation_mode,
                )
            except (ValueError, ValidationError) as exc:
                last_error = exc

        raise ValueError(
            f"Planner failed after {self.MAX_ATTEMPTS} attempts."
        ) from last_error

    def _generate_plan(
        self,
        specification_data: dict,
        generation_mode: str,
    ) -> ImplementationPlan:
        response = self.llm.generate(
            [
                {
                    "role": "system",
                    "content": PLANNER_SYSTEM_PROMPT,
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        specification_data,
                        indent=2,
                    ),
                },
            ],
            temperature=0.1,
            json_mode=True,
        )

        if not response.content:
            raise ValueError("Qwen returned an empty plan.")

        data = self._parse_json(response.content)
        plan = ImplementationPlan.model_validate(data)

        self._validate_plan(
            plan,
            generation_mode,
        )

        return plan

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
                f"Qwen returned invalid planner JSON.\n\nRaw output:\n{content}"
            ) from exc

        if not isinstance(data, dict):
            raise ValueError("Planner JSON root must be an object.")

        return data

    def _validate_plan(
        self,
        plan: ImplementationPlan,
        generation_mode: str = FRONTEND_PAGE,
    ) -> None:
        if not plan.tasks:
            raise ValueError("The implementation plan must contain at least one task.")
        if (
            generation_mode == self.FRONTEND_PAGE
            and len(plan.tasks) > self.MAX_FRONTEND_TASKS
        ):
            raise ValueError(
                f"Frontend-page plans must contain no more than "
                f"{self.MAX_FRONTEND_TASKS} tasks; "
                f"received {len(plan.tasks)}."
            )

        expected_ids = list(range(1, len(plan.tasks) + 1))
        actual_ids = [task.id for task in plan.tasks]

        if actual_ids != expected_ids:
            raise ValueError("Task IDs must be sequential starting from 1.")

        existing_ids = set()

        for task in plan.tasks:
            for dependency in task.dependencies:
                if dependency not in existing_ids:
                    raise ValueError(
                        f"Task {task.id} has invalid dependency {dependency}."
                    )

            if generation_mode == self.FRONTEND_PAGE:
                if task.type not in self.FRONTEND_PAGE_TASK_TYPES:
                    raise ValueError(
                        f"Task {task.id} has forbidden type '{task.type}' "
                        "for frontend-page mode. Only frontend and build "
                        "tasks are allowed."
                    )

                if not task.files:
                    raise ValueError(
                        f"Frontend-page task {task.id} must specify files."
                    )

            existing_ids.add(task.id)
