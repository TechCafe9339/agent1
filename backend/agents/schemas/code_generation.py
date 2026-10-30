from typing import Literal

from pydantic import BaseModel, Field, model_validator


class FileOperation(BaseModel):
    operation: Literal["write_file", "delete_file"]
    path: str
    content: str | None = None

    @model_validator(mode="after")
    def validate_operation(self):
        if not self.path.strip():
            raise ValueError("File path cannot be empty.")

        if self.operation == "write_file":
            if self.content is None:
                raise ValueError(
                    "write_file requires content."
                )

        return self


class CodeGenerationResult(BaseModel):
    summary: str
    operations: list[FileOperation] = Field(
        default_factory=list
    )