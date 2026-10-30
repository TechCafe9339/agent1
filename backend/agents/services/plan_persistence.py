from django.db import transaction

from agents.models import (
    ImplementationPlan,
    PlanTask,
)

from agents.schemas.plan import (
    ImplementationPlan as ImplementationPlanSchema,
)

from projects.models import Project


class PlanPersistenceService:

    @staticmethod
    @transaction.atomic
    def save(
        *,
        project: Project,
        plan: ImplementationPlanSchema,
    ) -> ImplementationPlan:

        database_plan, _ = (
            ImplementationPlan.objects.update_or_create(
                project=project,
                defaults={
                    "project_name": plan.project_name,
                    "summary": plan.summary,
                },
            )
        )

        database_plan.tasks.all().delete()

        tasks = []

        for task in plan.tasks:
            tasks.append(
                PlanTask(
                    plan=database_plan,
                    task_number=task.id,
                    task_type=task.type,
                    title=task.title,
                    description=task.description,
                    dependencies=task.dependencies,
                    files=task.files,
                )
            )

        PlanTask.objects.bulk_create(
            tasks
        )

        return database_plan