from agents.models import PlanTask

from agents.services.task_executor import (
    TaskExecutorService,
)

from projects.models import Project


class PlanExecutorService:

    def __init__(self):
        self.task_executor = TaskExecutorService()

    def execute_project(
        self,
        project: Project,
        *,
        max_tasks: int | None = None,
    ) -> dict:

        plan = project.implementation_plan

        results = []

        executed_count = 0

        while True:

            # Stop if we reached the requested limit.
            if max_tasks is not None and executed_count >= max_tasks:
                break

            task = self._get_next_task(
                project=project,
            )

            if task is None:
                break

            try:
                result = self.task_executor.execute(
                    project=project,
                    task=task,
                )

                results.append(result)

                executed_count += 1

            except Exception as exc:

                return {
                    "success": False,
                    "failed_task": task.task_number,
                    "failed_task_title": task.title,
                    "error": str(exc),
                    "executed_tasks": executed_count,
                    "results": results,
                }

        remaining = plan.tasks.exclude(
            status__in=[
                PlanTask.Status.COMPLETED,
                PlanTask.Status.SKIPPED,
            ]
        )

        # If max_tasks was deliberately used,
        # remaining tasks are completely normal.
        if max_tasks is not None:
            return {
                "success": True,
                "partial": True,
                "executed_tasks": executed_count,
                "remaining_tasks": remaining.count(),
                "results": results,
            }

        if remaining.exists():

            blocked = [
                {
                    "task_number": task.task_number,
                    "title": task.title,
                    "status": task.status,
                    "dependencies": task.dependencies,
                }
                for task in remaining
            ]

            return {
                "success": False,
                "error": ("Execution stopped because " "remaining tasks are blocked."),
                "blocked_tasks": blocked,
                "results": results,
            }

        return {
            "success": True,
            "partial": False,
            "executed_tasks": executed_count,
            "remaining_tasks": 0,
            "results": results,
        }

    def _get_next_task(
        self,
        *,
        project: Project,
    ) -> PlanTask | None:

        tasks = project.implementation_plan.tasks.filter(
            status=PlanTask.Status.PENDING
        ).order_by("task_number")

        for task in tasks:

            if self._dependencies_completed(task):
                return task

        return None

    def _dependencies_completed(
        self,
        task: PlanTask,
    ) -> bool:

        if not task.dependencies:
            return True

        completed = set(
            task.plan.tasks.filter(
                task_number__in=(task.dependencies),
                status=(PlanTask.Status.COMPLETED),
            ).values_list(
                "task_number",
                flat=True,
            )
        )

        required = set(task.dependencies)

        return required.issubset(completed)
