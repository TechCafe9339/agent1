from pydantic import BaseModel, Field

from agents.schemas.code_generation import (
    FileOperation,
)


class RepairResult(BaseModel):
    summary: str

    operations: list[FileOperation] = Field(
        default_factory=list
    )