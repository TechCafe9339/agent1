from typing import Literal

from pydantic import BaseModel, Field


TaskType = Literal[
    "database",
    "backend",
    "frontend",
    "integration",
    "build",
]


class PlanTask(BaseModel):
    id: int

    type: TaskType

    title: str

    description: str

    dependencies: list[int] = Field(
        default_factory=list
    )

    files: list[str] = Field(
        default_factory=list
    )


class ImplementationPlan(BaseModel):
    project_name: str

    summary: str

    tasks: list[PlanTask]