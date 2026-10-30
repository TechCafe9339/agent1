
from django.utils import timezone

from agents.models import PlanTask
from agents.services.code_generator import CodeGeneratorService
from agents.services.file_operations import FileOperationService
from agents.services.repair_agent import RepairAgentService
from agents.services.task_validator import TaskValidatorService
from projects.models import Project
from workspaces.exceptions import SandboxUnavailableError
from workspaces.manager import WorkspaceManager


class TaskExecutorService:
    MAX_REPAIR_ATTEMPTS_FRONTEND = 1
    MAX_REPAIR_ATTEMPTS_FULL_STACK = 2
    FRONTEND_PAGE = "frontend_page"
    FULL_STACK = "full_stack"

    def __init__(self):
        self.generator = CodeGeneratorService()
        self.validator = TaskValidatorService()
        self.repair_agent = RepairAgentService()

    # =================================================
    # Main task execution
    # =================================================

    def execute(self, *, project: Project, task: PlanTask) -> dict:
        self._validate_project_task(project=project, task=task)
        self._validate_dependencies(task)

        workspace = WorkspaceManager(project)

        if not workspace.exists():
            raise ValueError(
                f"Workspace does not exist for project {project.id}."
            )

        task.status = PlanTask.Status.RUNNING
        task.started_at = timezone.now()
        task.completed_at = None
        task.error_message = ""
        task.save(
            update_fields=[
                "status",
                "started_at",
                "completed_at",
                "error_message",
                "updated_at",
            ]
        )

        try:
            file_tree = workspace.list_files()

            relevant_files = self._load_relevant_files(
                project=project,
                workspace=workspace,
                task=task,
            )

            specification_data = self._get_specification_data(project)

            generation_result = self.generator.generate(
                task=task,
                application_specification=specification_data,
                file_tree=file_tree,
                relevant_files=relevant_files,
                generation_mode=project.generation_mode,
            )

            self._validate_operation_scope(
                operations=generation_result.operations,
                allowed_paths=set(task.files),
                agent_name="Generator",
            )

            changed_files = FileOperationService.apply(
                workspace=workspace,
                result=generation_result,
            )

            existing_files = {
                self._normalize_path(path)
                for path in workspace.list_files()
            }

            missing_files = [
                path
                for path in task.files
                if self._normalize_path(path) not in existing_files
            ]

            if missing_files:
                raise ValueError(
                    "Generator did not create the required task files: "
                    f"{missing_files}"
                )

            try:
                validation = self.validator.validate(
                    workspace=workspace,
                    task=task,
                )
            except SandboxUnavailableError:
                raise

            repair_files = []

            if not validation.success:
                repair_result = self._repair_task(
                    project=project,
                    task=task,
                    workspace=workspace,
                    errors=validation.errors,
                )

                validation = repair_result["validation"]
                repair_files = repair_result["changed_files"]

            if not validation.success:
                error_text = "\n\n".join(validation.errors)
                raise ValueError(
                    "Task validation failed after automatic repair.\n\n"
                    f"{error_text}"
                )

            task.status = PlanTask.Status.COMPLETED
            task.completed_at = timezone.now()
            task.error_message = ""
            task.save(
                update_fields=[
                    "status",
                    "completed_at",
                    "error_message",
                    "updated_at",
                ]
            )

            all_changed_files = list(
                dict.fromkeys(changed_files + repair_files)
            )

            return {
                "success": True,
                "task_number": task.task_number,
                "task_title": task.title,
                "summary": generation_result.summary,
                "changed_files": all_changed_files,
                "validation_logs": validation.logs,
            }

        except Exception as exc:
            task.status = PlanTask.Status.FAILED
            task.error_message = str(exc)
            task.completed_at = timezone.now()
            task.save(
                update_fields=[
                    "status",
                    "error_message",
                    "completed_at",
                    "updated_at",
                ]
            )
            raise

    # =================================================
    # Automatic repair
    # =================================================

    def _repair_task(
        self,
        *,
        project: Project,
        task: PlanTask,
        workspace: WorkspaceManager,
        errors: list[str],
    ) -> dict:
        specification_data = self._get_specification_data(project)
        current_errors = errors
        changed_files: list[str] = []
        last_validation = None

        is_frontend_only = (
            project.generation_mode == self.FRONTEND_PAGE
        )

        max_repair_attempts = (
            self.MAX_REPAIR_ATTEMPTS_FRONTEND
            if is_frontend_only
            else self.MAX_REPAIR_ATTEMPTS_FULL_STACK
        )

        for attempt in range(1, max_repair_attempts + 1):
            file_tree = workspace.list_files()
            repair_paths = set(task.files)

            # Include relevant shared project files.
            if "frontend/package.json" in file_tree:
                frontend_root = "frontend"
            else:
                frontend_root = ""

            if frontend_root:
                repair_paths.update({
                    "frontend/package.json",
                    "frontend/tsconfig.json",
                    "frontend/next.config.mjs",
                    "frontend/app/layout.tsx",
                    "frontend/app/page.tsx",
                    "frontend/app/globals.css",
                })
            else:
                repair_paths.update({
                    "package.json",
                    "tsconfig.json",
                    "next.config.ts",
                    "next.config.mjs",
                    "next.config.js",
                    "app/layout.tsx",
                    "app/page.tsx",
                    "app/globals.css",
                })

            if not is_frontend_only:
                repair_paths.update({
                    "backend/src/config/prisma.ts",
                    "backend/src/middleware/auth.middleware.ts",
                    "backend/src/server.ts",
                    "backend/package.json",
                    "backend/tsconfig.json",
                    "backend/prisma/schema.prisma",
                })

            repair_files: dict[str, str] = {}

            for path in repair_paths:
                try:
                    repair_files[path] = workspace.read_file(path)
                except (
                    FileNotFoundError,
                    UnicodeDecodeError,
                    IsADirectoryError,
                ):
                    continue
                except Exception:
                    continue

            repair_file_tree = [
                path
                for path in file_tree
                if path in repair_paths
                or (
                    not is_frontend_only
                    and (
                        path.startswith("backend/src/controllers/")
                        or path.startswith("backend/src/routes/")
                        or path.startswith("backend/src/middleware/")
                        or path.startswith("backend/src/config/")
                    )
                )
            ]

            if not is_frontend_only:
                repair_file_tree = [
                    path
                    for path in repair_file_tree
                    if not path.startswith(
                        "backend/src/generated/prisma/"
                    )
                ]

            repair_result = self.repair_agent.repair(
                application_specification=specification_data,
                task=self._get_task_data(task),
                errors=current_errors,
                file_tree=repair_file_tree,
                relevant_files=repair_files,
            )

            self._validate_operation_scope(
                operations=repair_result.operations,
                allowed_paths=set(task.files),
                agent_name="Repair agent",
            )

            repair_changed_files = FileOperationService.apply(
                workspace=workspace,
                result=repair_result,
            )

            changed_files.extend(repair_changed_files)

            last_validation = self.validator.validate(
                workspace=workspace,
                task=task,
            )

            if last_validation.success:
                return {
                    "validation": last_validation,
                    "changed_files": list(dict.fromkeys(changed_files)),
                    "attempts": attempt,
                }

            current_errors = last_validation.errors

        if last_validation is None:
            raise ValueError("Automatic repair did not run.")

        return {
            "validation": last_validation,
            "changed_files": list(dict.fromkeys(changed_files)),
            "attempts": max_repair_attempts,
        }

    # =================================================
    # Operation scope enforcement
    # =================================================

    
    @staticmethod
    def _normalize_path(path: str) -> str:
        path = path.strip().replace("\\", "/")

        while path.startswith("./"):
            path = path[2:]

        path = path.rstrip("/")
        parts = path.split("/")

        if (
            not path
            or path.startswith("/")
            or any(part in {"", ".", ".."} for part in parts)
            or ":" in parts[0]
        ):
            raise ValueError(f"Unsafe file path: {path!r}")

        return path

    @classmethod
    def _validate_operation_scope(
        cls,
        *,
        operations,
        allowed_paths: set[str],
        agent_name: str,
    ) -> None:
        normalized_allowed = {
            cls._normalize_path(path)
            for path in allowed_paths
        }

        unexpected_paths = []

        for operation in operations:
            try:
                path = cls._normalize_path(operation.path)
            except ValueError:
                unexpected_paths.append(operation.path)
                continue

            if path not in normalized_allowed:
                unexpected_paths.append(operation.path)

        if unexpected_paths:
            raise ValueError(
                f"{agent_name} attempted to modify files outside "
                f"the current task scope: {unexpected_paths}. "
                f"Allowed files: {sorted(normalized_allowed)}"
            )

    # =================================================
    # Dependency validation
    # =================================================

    def _validate_dependencies(self, task: PlanTask) -> None:
        if not task.dependencies:
            return

        completed_numbers = set(
            task.plan.tasks.filter(
                task_number__in=task.dependencies,
                status=PlanTask.Status.COMPLETED,
            ).values_list("task_number", flat=True)
        )

        missing = set(task.dependencies) - completed_numbers

        if missing:
            raise ValueError(
                f"Task dependencies are not completed: {sorted(missing)}"
            )

    # =================================================
    # Project / task relationship
    # =================================================

    @staticmethod
    def _validate_project_task(
        *,
        project: Project,
        task: PlanTask,
    ) -> None:
        if task.plan.project_id != project.id:
            raise ValueError(
                "The supplied task does not belong to this project."
            )

    # =================================================
    # Application specification
    # =================================================

    def _get_specification_data(self, project: Project) -> dict:
        try:
            specification = project.application_specification
        except Exception as exc:
            raise ValueError(
                "Project does not have an application specification."
            ) from exc

        return {
            "generation_mode": project.generation_mode,
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

    # =================================================
    # Task data sent to repair agent
    # =================================================

    @staticmethod
    def _get_task_data(task: PlanTask) -> dict:
        return {
            "id": task.task_number,
            "type": task.task_type,
            "title": task.title,
            "description": task.description,
            "files": task.files,
            "dependencies": task.dependencies,
        }

    # =================================================
    # Relevant project files
    # =================================================

    def _load_relevant_files(
        self,
        *,
        project: Project,
        workspace: WorkspaceManager,
        task: PlanTask,
    ) -> dict[str, str]:
        relevant: dict[str, str] = {}
        existing_files = set(workspace.list_files())
        is_frontend_only = (
            project.generation_mode == self.FRONTEND_PAGE
        )

        if "frontend/package.json" in existing_files:
            frontend_root = "frontend"
        else:
            frontend_root = ""

        candidate_files = set(task.files)

        if frontend_root:
            candidate_files.update({
                "frontend/package.json",
                "frontend/tsconfig.json",
                "frontend/next.config.mjs",
                "frontend/next.config.ts",
                "frontend/next.config.js",
                "frontend/app/layout.tsx",
                "frontend/app/page.tsx",
                "frontend/app/globals.css",
            })
        else:
            candidate_files.update({
                "package.json",
                "tsconfig.json",
                "next.config.ts",
                "next.config.mjs",
                "next.config.js",
                "app/layout.tsx",
                "app/page.tsx",
                "app/globals.css",
            })

        if not is_frontend_only:
            candidate_files.update({
                "backend/package.json",
                "backend/tsconfig.json",
                "backend/prisma/schema.prisma",
                "backend/src/server.ts",
            })

        for path in candidate_files:
            if path not in existing_files:
                continue

            try:
                relevant[path] = workspace.read_file(path)
            except (
                UnicodeDecodeError,
                IsADirectoryError,
                FileNotFoundError,
            ):
                continue

        return relevant
