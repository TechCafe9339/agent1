from pydantic import BaseModel, Field


class StackSpecification(BaseModel):
    frontend: str = "nextjs"
    backend: str = "express"
    database: str = "none"
    orm: str = "none"
    language: str = "typescript"


class EntitySpecification(BaseModel):
    name: str
    description: str = ""


class ApplicationSpecification(BaseModel):
    name: str

    description: str

    application_type: str = "web_application"

    stack: StackSpecification = Field(
        default_factory=StackSpecification
    )

    features: list[str]

    entities: list[EntitySpecification]

    pages: list[str]

    user_roles: list[str] = Field(
        default_factory=lambda: ["user"]
    )

    assumptions: list[str] = Field(
        default_factory=list
    )