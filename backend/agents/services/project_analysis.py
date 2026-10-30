
from agents.services.requirement_analyzer import (
    RequirementAnalyzer,
)

from projects.models import (
    ApplicationSpecification,
    Project,
)

from projects.services.specifications import (
    ApplicationSpecificationService,
)


class ProjectAnalysisService:

    def __init__(self):
        self.analyzer = RequirementAnalyzer()

    def analyze_project(
        self,
        project: Project,
    ) -> ApplicationSpecification:

        if not project.initial_prompt.strip():
            raise ValueError(
                "Project does not have an initial prompt."
            )

        project.status = Project.Status.PLANNING

        project.save(
            update_fields=[
                "status",
                "updated_at",
            ]
        )

        try:
            specification = self.analyzer.analyze(
                project.initial_prompt,
                generation_mode=project.generation_mode,
            )

            database_specification = (
                ApplicationSpecificationService.save(
                    project=project,
                    specification=specification,
                )
            )

            return database_specification

        except Exception:
            project.status = Project.Status.FAILED

            project.save(
                update_fields=[
                    "status",
                    "updated_at",
                ]
            )

            raise
