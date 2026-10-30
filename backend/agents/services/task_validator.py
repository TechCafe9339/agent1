
from dataclasses import dataclass, field

from agents.models import PlanTask
from workspaces.manager import WorkspaceManager
from workspaces.sandbox import ProjectSandbox


@dataclass
class ValidationResult:
    success: bool
    errors: list[str] = field(default_factory=list)
    logs: list[str] = field(default_factory=list)


class TaskValidatorService:
    FRONTEND_PAGE = "frontend_page"
    FULL_STACK = "full_stack"

    def validate(
        self,
        *,
        workspace: WorkspaceManager,
        task: PlanTask,
    ) -> ValidationResult:
        sandbox = ProjectSandbox(workspace)
        errors: list[str] = []
        logs: list[str] = []

        project = getattr(workspace, "project", None)
        generation_mode = getattr(
            workspace,
            "generation_mode",
            getattr(project, "generation_mode", self.FULL_STACK),
        )

        frontend_only = generation_mode == self.FRONTEND_PAGE

        if generation_mode not in {
            self.FRONTEND_PAGE,
            self.FULL_STACK,
        }:
            errors.append(
                f"Unsupported generation mode: {generation_mode}"
            )

        elif frontend_only and task.task_type in {
            PlanTask.TaskType.DATABASE,
            PlanTask.TaskType.BACKEND,
            PlanTask.TaskType.INTEGRATION,
        }:
            errors.append(
                f"Task type '{task.task_type}' is not supported "
                "in frontend-only mode. Only FRONTEND and BUILD "
                "tasks are allowed."
            )

        elif task.task_type == PlanTask.TaskType.DATABASE:
            self._validate_database(
                sandbox=sandbox,
                errors=errors,
                logs=logs,
            )

        elif task.task_type == PlanTask.TaskType.BACKEND:
            self._validate_backend(
                sandbox=sandbox,
                errors=errors,
                logs=logs,
            )

        elif task.task_type == PlanTask.TaskType.FRONTEND:
            self._validate_frontend(
                sandbox=sandbox,
                errors=errors,
                logs=logs,
            )

        elif task.task_type == PlanTask.TaskType.INTEGRATION:
            self._validate_backend(
                sandbox=sandbox,
                errors=errors,
                logs=logs,
            )

            if not errors:
                self._validate_frontend(
                    sandbox=sandbox,
                    errors=errors,
                    logs=logs,
                )

        elif task.task_type == PlanTask.TaskType.BUILD:
            if not frontend_only:
                self._validate_backend(
                    sandbox=sandbox,
                    errors=errors,
                    logs=logs,
                )

            if not errors:
                self._validate_frontend(
                    sandbox=sandbox,
                    errors=errors,
                    logs=logs,
                )

        else:
            errors.append(
                f"Unsupported task type: {task.task_type}"
            )

        return ValidationResult(
            success=not errors,
            errors=errors,
            logs=logs,
        )

    def _validate_database(
        self,
        *,
        sandbox,
        errors: list[str],
        logs: list[str],
    ) -> None:
        install_result = sandbox.install_backend()

        self._collect_result(
            result=install_result,
            errors=errors,
            logs=logs,
        )

        if not install_result.success:
            return

        result = sandbox.run_backend_command(
            ["npx", "--no-install", "prisma", "validate"]
        )

        self._collect_result(
            result=result,
            errors=errors,
            logs=logs,
        )

    def _validate_backend(
        self,
        *,
        sandbox,
        errors: list[str],
        logs: list[str],
    ) -> None:
        result = sandbox.build_backend()

        self._collect_result(
            result=result,
            errors=errors,
            logs=logs,
        )

    def _validate_frontend(
        self,
        *,
        sandbox,
        errors: list[str],
        logs: list[str],
    ) -> None:
        install_result = sandbox.install_frontend()

        self._collect_result(
            result=install_result,
            errors=errors,
            logs=logs,
        )

        if not install_result.success:
            return

        build_result = sandbox.build_frontend()

        self._collect_result(
            result=build_result,
            errors=errors,
            logs=logs,
        )

    @staticmethod
    def _collect_result(
        *,
        result,
        errors: list[str],
        logs: list[str],
    ) -> None:
        if result.stdout:
            logs.append(result.stdout)

        if result.stderr:
            logs.append(result.stderr)

        if not result.success:
            error = (
                result.stderr.strip()
                or result.stdout.strip()
                or "Validation command failed without output."
            )
            errors.append(error)
