
from agents.services.planner import PlannerService

from agents.services.plan_persistence import (
    PlanPersistenceService,
)

from projects.models import Project


class ProjectPlanningService:

    def __init__(self):
        self.planner = PlannerService()

    def create_plan(self, project: Project):
        specification = project.application_specification

        plan = self.planner.create_plan(
            specification,
            generation_mode=project.generation_mode,
        )

        return PlanPersistenceService.save(
            project=project,
            plan=plan,
        )
