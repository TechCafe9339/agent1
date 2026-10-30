import os
from pathlib import Path
import traceback
import shutil

from django.conf import settings
from projects.preview_manager import preview_manager
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from conversations.models import Message
from agents.services.chat import AIChatService
from agents.services.plan_executor import (
    PlanExecutorService,
)

from workspaces.manager import (
    WorkspaceManager,
)

from agents.services.change_impact import (
    ChangeImpactAnalyzer,
)
from agents.services.chat_intent import (
    ProjectChatIntentService,
)
from agents.services.project_analysis import (
    ProjectAnalysisService,
)
from agents.services.project_change import (
    ProjectChangeService,
)
from agents.services.project_planning import (
    ProjectPlanningService,
)

from projects.models import (
    PendingProjectChange,
    Project,
)
from projects.serializers import (
    ProjectSerializer,
)


class ProjectViewSet(viewsets.ModelViewSet):
    serializer_class = ProjectSerializer

    # =========================================================
    # HELPERS
    # =========================================================

    def _workspace_root(self, project: Project) -> Path:
        return WorkspaceManager(project).workspace_path

    def _serialize_message(
        self,
        message,
    ):
        return {
            "id": message.id,
            "role": message.role,
            "content": message.content,
            "timestamp": message.created_at,
        }

    def _delete_project_entry(self, project: Project, requested_path: str):
        """
        Delete a file or a whole folder inside the project's workspace.
        """
        workspace_root = self._workspace_root(project).resolve()

        if not workspace_root.exists():
            return Response(
                {"error": "Project workspace does not exist."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # -----------------------------------------
        # Validate the path (no absolute paths, no ../, no workspace root)
        # -----------------------------------------

        normalized = requested_path.replace("\\", "/").strip("/")
        parts = normalized.split("/") if normalized else []

        if (
            not parts
            or Path(requested_path).is_absolute()
            or any(part in ("", ".", "..") for part in parts)
        ):
            return Response(
                {"error": "Invalid path."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Resolve only the parent, so a symlink can be removed
        # without following it to wherever it points.
        parent = workspace_root.joinpath(*parts).parent.resolve()

        try:
            parent.relative_to(workspace_root)
        except ValueError:
            return Response(
                {"error": "Invalid path."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        target = parent / parts[-1]

        if not os.path.lexists(target):
            return Response(
                {"error": "File or folder not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # -----------------------------------------
        # Delete
        # -----------------------------------------

        try:
            if target.is_symlink() or target.is_file():
                target.unlink()
                entry_type = "file"
            else:
                shutil.rmtree(target)
                entry_type = "directory"

        except OSError as exc:
            return Response(
                {"error": f"Unable to delete: {exc}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(
            {
                "success": True,
                "path": normalized,
                "type": entry_type,
                "message": "Deleted successfully.",
            },
            status=status.HTTP_200_OK,
        )

    # =========================================================
    # PROJECT OWNERSHIP
    # =========================================================

    def get_queryset(self):
        """
        Users can only access their own projects.
        """

        return Project.objects.filter(user=self.request.user).order_by("-id")

    def perform_create(
        self,
        serializer,
    ):
        # 1. Save the project in the database
        project = serializer.save(user=self.request.user)

        # 2. Create its workspace folder
        workspace = WorkspaceManager(project)

        if not workspace.exists():
            workspace.create()

        print(
            "PROJECT CREATED:",
            project.id,
        )

        print(
            "WORKSPACE PATH:",
            workspace.workspace_path,
        )

    # =========================================================
    # PREPARE PROJECT
    # Requirement Analysis + Planning
    # =========================================================

    @action(
        detail=True,
        methods=["post"],
        url_path="prepare",
    )
    def prepare_project(
        self,
        request,
        pk=None,
    ):
        project = self.get_object()

        try:
            # -----------------------------------------
            # 1. Analyze requirements
            # -----------------------------------------

            analysis_service = ProjectAnalysisService()

            specification = analysis_service.analyze_project(project)

            # -----------------------------------------
            # 2. Create implementation plan
            # -----------------------------------------

            planning_service = ProjectPlanningService()

            plan = planning_service.create_plan(project)

            project.refresh_from_db()

            return Response(
                {
                    "project": ProjectSerializer(project).data,
                    "specification_id": specification.id,
                    "plan_id": plan.id,
                    "message": ("Project analyzed and " "planned successfully."),
                },
                status=(status.HTTP_200_OK),
            )

        except Exception as exc:
            print("\n" "========== PREPARE PROJECT ERROR ==========")

            print(
                "PROJECT ID:",
                project.id,
            )

            print(
                "ERROR TYPE:",
                type(exc).__name__,
            )

            print(
                "ERROR:",
                str(exc),
            )

            traceback.print_exc()

            print("===========================================" "\n")

            project.status = Project.Status.FAILED

            project.save(
                update_fields=[
                    "status",
                    "updated_at",
                ]
            )

            return Response(
                {
                    "error": str(exc),
                    "error_type": type(exc).__name__,
                    "project_id": project.id,
                },
                status=(status.HTTP_500_INTERNAL_SERVER_ERROR),
            )

    # =========================================================
    # GENERATE PROJECT
    # Workspace Creation + Plan Execution
    # =========================================================

    @action(
        detail=True,
        methods=["post"],
        url_path="generate",
    )
    def generate_project(
        self,
        request,
        pk=None,
    ):
        project = self.get_object()

        # -----------------------------------------------------
        # 1. Make sure the project has an implementation plan
        # -----------------------------------------------------

        if not hasattr(
            project,
            "implementation_plan",
        ):
            return Response(
                {
                    "error": (
                        "Project does not have an "
                        "implementation plan. "
                        "Run project preparation first."
                    ),
                    "project_id": project.id,
                },
                status=(status.HTTP_400_BAD_REQUEST),
            )

        try:
            # -------------------------------------------------
            # 2. Mark project as generating
            # -------------------------------------------------

            project.status = Project.Status.GENERATING

            project.save(
                update_fields=[
                    "status",
                    "updated_at",
                ]
            )

            # -------------------------------------------------
            # 3. Create project workspace
            # -------------------------------------------------

            workspace = WorkspaceManager(project)

            workspace_created = False

            if not workspace.exists():
                workspace.create()

                workspace_created = True

                print(
                    "WORKSPACE CREATED:",
                    workspace.workspace_path,
                )

            else:
                print(
                    "WORKSPACE ALREADY EXISTS:",
                    workspace.workspace_path,
                )

            # -------------------------------------------------
            # 4. Execute implementation plan
            # -------------------------------------------------

            executor = PlanExecutorService()

            execution_result = executor.execute_project(project)

            # -------------------------------------------------
            # 5. Handle failed generation
            # -------------------------------------------------

            if not execution_result.get(
                "success",
                False,
            ):
                project.status = Project.Status.FAILED

                project.save(
                    update_fields=[
                        "status",
                        "updated_at",
                    ]
                )

                return Response(
                    {
                        "success": False,
                        "project_id": project.id,
                        "workspace_created": workspace_created,
                        "workspace": str(workspace.workspace_path),
                        "generation": execution_result,
                        "message": (
                            "Project generation "
                            "stopped because a task "
                            "failed or became blocked."
                        ),
                    },
                    status=(status.HTTP_422_UNPROCESSABLE_ENTITY),
                )

            # -------------------------------------------------
            # 6. Generation completed
            # -------------------------------------------------

            project.status = Project.Status.READY

            project.save(
                update_fields=[
                    "status",
                    "updated_at",
                ]
            )

            project.refresh_from_db()

            return Response(
                {
                    "success": True,
                    "project": ProjectSerializer(project).data,
                    "workspace_created": workspace_created,
                    "workspace": str(workspace.workspace_path),
                    "generation": execution_result,
                    "message": ("Project generated " "successfully."),
                },
                status=(status.HTTP_200_OK),
            )

        except Exception as exc:
            print("\n" "========== GENERATE PROJECT ERROR ==========")

            print(
                "PROJECT ID:",
                project.id,
            )

            print(
                "ERROR TYPE:",
                type(exc).__name__,
            )

            print(
                "ERROR:",
                str(exc),
            )

            print("TRACEBACK:")

            traceback.print_exc()

            print("============================================" "\n")

            project.status = Project.Status.FAILED

            project.save(
                update_fields=[
                    "status",
                    "updated_at",
                ]
            )

            return Response(
                {
                    "success": False,
                    "error": str(exc),
                    "error_type": type(exc).__name__,
                    "project_id": project.id,
                },
                status=(status.HTTP_500_INTERNAL_SERVER_ERROR),
            )

    # =========================================================
    # PROJECT WORKSPACE
    # =========================================================

    @action(
        detail=True,
        methods=["get"],
        url_path="workspace",
    )
    def workspace(
        self,
        request,
        pk=None,
    ):
        project = self.get_object()

        specification_data = None
        plan_data = None

        workspace_root = self._workspace_root(project)

        # -----------------------------------------
        # Application specification
        # -----------------------------------------

        if hasattr(
            project,
            "application_specification",
        ):
            specification = project.application_specification

            specification_data = {
                "id": specification.id,
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

        # -----------------------------------------
        # Implementation plan
        # -----------------------------------------

        if hasattr(
            project,
            "implementation_plan",
        ):
            plan = project.implementation_plan

            tasks = []

            for task in plan.tasks.all().order_by("task_number"):
                tasks.append(
                    {
                        "id": task.id,
                        "task_number": task.task_number,
                        "title": task.title,
                        "status": task.status,
                    }
                )

            plan_data = {
                "id": plan.id,
                "tasks": tasks,
            }

        return Response(
            {
                "project": ProjectSerializer(project).data,
                "workspace_exists": workspace_root.exists(),
                "specification": specification_data,
                "plan": plan_data,
            },
            status=(status.HTTP_200_OK),
        )

    # =========================================================
    # PROJECT FILE TREE
    # =========================================================

    @action(
        detail=True,
        methods=["get"],
        url_path="files",
    )
    def project_files(
        self,
        request,
        pk=None,
    ):
        project = self.get_object()

        workspace_root = self._workspace_root(project)

        if not workspace_root.exists():
            return Response(
                {
                    "exists": False,
                    "files": [],
                },
                status=(status.HTTP_200_OK),
            )

        ignored_directories = {
            "node_modules",
            ".next",
            "dist",
            ".git",
            "__pycache__",
            ".pytest_cache",
            ".turbo",
        }

        ignored_files = {
            ".env",
            ".env.local",
            ".env.development",
            ".env.production",
            ".env.test",
            ".npmrc",
        }

        def should_hide_file(
            path: Path,
        ) -> bool:
            name = path.name.lower()

            if name in ignored_files:
                return True

            if name.startswith(".env."):
                return True

            if name.endswith(
                (
                    ".pem",
                    ".key",
                    ".p12",
                    ".pfx",
                )
            ):
                return True

            return False

        def build_tree(
            directory: Path,
        ):
            items = []

            try:
                directory_items = directory.iterdir()

            except (
                PermissionError,
                OSError,
            ):
                return items

            for item in sorted(
                directory_items,
                key=lambda path: (
                    not path.is_dir(),
                    path.name.lower(),
                ),
            ):
                if item.is_dir() and item.name in ignored_directories:
                    continue

                if item.is_file() and should_hide_file(item):
                    continue

                relative_path = item.relative_to(workspace_root).as_posix()

                if item.is_dir():
                    items.append(
                        {
                            "name": item.name,
                            "path": relative_path,
                            "type": "directory",
                            "children": build_tree(item),
                        }
                    )

                else:
                    items.append(
                        {
                            "name": item.name,
                            "path": relative_path,
                            "type": "file",
                        }
                    )

            return items

        return Response(
            {
                "exists": True,
                "files": build_tree(workspace_root),
            },
            status=(status.HTTP_200_OK),
        )

    # =========================================================
    # READ / DELETE INDIVIDUAL PROJECT FILE OR FOLDER
    # =========================================================

    @action(
        detail=True,
        methods=["get", "delete"],
        url_path="file",
    )
    def project_file(
        self,
        request,
        pk=None,
    ):
        project = self.get_object()

        requested_path = request.query_params.get(
            "path",
            "",
        ).strip()

        if not requested_path:
            return Response(
                {"error": ("File path is required.")},
                status=(status.HTTP_400_BAD_REQUEST),
            )

        # DELETE handles both files and folders.
        if request.method == "DELETE":
            return self._delete_project_entry(project, requested_path)

        requested_name = Path(requested_path).name.lower()

        blocked_files = {
            ".env",
            ".env.local",
            ".env.development",
            ".env.production",
            ".env.test",
            ".npmrc",
        }

        if (
            requested_name in blocked_files
            or requested_name.startswith(".env.")
            or requested_name.endswith(
                (
                    ".pem",
                    ".key",
                    ".p12",
                    ".pfx",
                )
            )
        ):
            return Response(
                {"error": ("This file cannot " "be previewed.")},
                status=(status.HTTP_403_FORBIDDEN),
            )

        workspace_root = self._workspace_root(project).resolve()

        file_path = (workspace_root / requested_path).resolve()

        # -----------------------------------------
        # Prevent ../ path traversal
        # -----------------------------------------

        try:
            file_path.relative_to(workspace_root)

        except ValueError:
            return Response(
                {"error": "Invalid file path."},
                status=(status.HTTP_400_BAD_REQUEST),
            )

        if not file_path.exists() or not file_path.is_file():
            return Response(
                {"error": "File not found."},
                status=(status.HTTP_404_NOT_FOUND),
            )

        max_size = 1024 * 1024

        if file_path.stat().st_size > max_size:
            return Response(
                {"error": ("File is too large " "to preview.")},
                status=(status.HTTP_400_BAD_REQUEST),
            )

        try:
            content = file_path.read_text(encoding="utf-8")

        except UnicodeDecodeError:
            return Response(
                {"error": ("Binary files cannot " "be previewed.")},
                status=(status.HTTP_400_BAD_REQUEST),
            )

        except OSError as exc:
            return Response(
                {"error": ("Unable to read file: " f"{str(exc)}")},
                status=(status.HTTP_500_INTERNAL_SERVER_ERROR),
            )

        return Response(
            {
                "name": file_path.name,
                "path": requested_path,
                "content": content,
            },
            status=(status.HTTP_200_OK),
        )

    # =========================================================
    # PROJECT CHAT
    # =========================================================

    @action(
        detail=True,
        methods=[
            "get",
            "post",
        ],
        url_path="chat",
    )
    def project_chat(
        self,
        request,
        pk=None,
    ):
        project = self.get_object()

        conversation = project.get_or_create_main_conversation()

        # =====================================================
        # GET CHAT HISTORY
        # =====================================================

        if request.method == "GET":
            messages = conversation.messages.all().order_by("created_at")

            return Response(
                {
                    "conversation_id": conversation.id,
                    "messages": [
                        self._serialize_message(message) for message in messages
                    ],
                },
                status=(status.HTTP_200_OK),
            )

        # =====================================================
        # POST MESSAGE
        # =====================================================

        content = request.data.get(
            "content",
            "",
        ).strip()

        if not content:
            return Response(
                {"error": ("Message cannot " "be empty.")},
                status=(status.HTTP_400_BAD_REQUEST),
            )

        user_message = conversation.messages.create(
            role="user",
            content=content,
        )

        try:
            # =================================================
            # 1. CLASSIFY INTENT
            # =================================================

            intent_service = ProjectChatIntentService()

            intent_result = intent_service.classify(content)

            intent = intent_result["intent"]

            intent_summary = intent_result["summary"]

            print(
                "CHAT INTENT:",
                intent,
            )

            print(
                "CHAT SUMMARY:",
                intent_summary,
            )

            # =================================================
            # 2. QUESTION
            # =================================================

            if intent == "question":
                project_context = f"""
You are Prompt2Web, an AI assistant working on an existing software project.

PROJECT NAME:
{project.name}

PROJECT STATUS:
{project.status}

ORIGINAL PROJECT REQUEST:
{project.initial_prompt}

USER QUESTION:
{content}

Answer specifically about this project.

Give a clear and concise software-development explanation.

Do not claim that files were modified.

Do not claim that builds or tests were executed unless they actually were.
"""

                chat_service = AIChatService()

                llm_response = chat_service.send(project_context)

                assistant_content = llm_response.content.strip()

            # =================================================
            # 3. PROJECT CHANGE REQUEST
            # =================================================

            elif intent == "change_request":
                workspace_root = self._workspace_root(project)

                # ---------------------------------------------
                # Important:
                # A planned project cannot be modified until
                # generated files actually exist.
                # ---------------------------------------------

                if not workspace_root.exists():
                    assistant_content = (
                        "I recognized this as a project "
                        "change request.\n\n"
                        f"Requested change:\n"
                        f"{intent_summary}\n\n"
                        "However, this project's application "
                        "has not been generated yet, so there "
                        "are no source files available to "
                        "modify.\n\n"
                        "Generate the application first. "
                        "After the project workspace exists, "
                        "I can apply this change to the "
                        "generated source code."
                    )

                else:
                    # -----------------------------------------
                    # A. Analyze change impact
                    # -----------------------------------------

                    impact_analyzer = ChangeImpactAnalyzer()

                    impact = impact_analyzer.analyze(
                        project=project,
                        change_request=content,
                    )

                    affected_files = impact.get(
                        "affected_files",
                        [],
                    )

                    new_files = impact.get(
                        "new_files",
                        [],
                    )

                    # -----------------------------------------
                    # B. Ensure analyzer found something
                    # -----------------------------------------

                    if not affected_files and not new_files:
                        assistant_content = (
                            "I analyzed the requested change "
                            "but could not safely determine "
                            "which project files should be "
                            "modified.\n\n"
                            f"Requested change:\n"
                            f"{impact.get('summary', content)}"
                        )

                    else:
                        # -----------------------------------------
                        # C. Save proposal;
                        # -----------------------------------------

                        risk = impact.get("risk", "medium").lower()
                        summary = impact.get("summary", intent_summary)

                        # Keep high-risk changes behind approval.
                        if risk == "high":
                            pending_change = PendingProjectChange.objects.create(
                                project=project,
                                user=request.user,
                                request_text=content,
                                summary=summary,
                                affected_files=affected_files,
                                new_files=new_files,
                                risk=risk,
                                status=PendingProjectChange.Status.PENDING,
                            )

                            assistant_content = (
                                "This change requires approval before "
                                "modifying your project.\n\n"
                                f"Proposal ID: {pending_change.id}\n"
                                f"Change: {summary}\n"
                                f"Risk: {risk.upper()}\n\n"
                                "Potentially affected files:\n"
                                + "\n".join(
                                    f"- {path}"
                                    for path in affected_files + new_files
                                )
                                + "\n\nApprove the proposal to apply it."
                            )

                        else:
                            # Apply low- and medium-risk changes now.
                            change_service = ProjectChangeService()

                            change_result = change_service.apply(
                                project=project,
                                change_request=content,
                                affected_files=affected_files,
                                new_files=new_files,
                            )

                            written_files = change_result.get(
                                "written_files", []
                            )

                            if not written_files:
                                raise ValueError(
                                    "The change engine did not write any files. "
                                    "The project has not been confirmed as updated."
                                )

                            assistant_content = (
                                "Project changes applied successfully.\n\n"
                                f"Summary: {change_result.get('summary', summary)}"
                                "\n\nUpdated files:\n"
                                + "\n".join(
                                    f"- {path}" for path in written_files
                                )
                            )

            # =================================================
            # UNKNOWN INTENT
            # =================================================

            else:
                raise ValueError(("Unknown chat intent: " f"{intent}"))

            if not assistant_content:
                raise ValueError(("LLM returned an " "empty response."))

            # =================================================
            # SAVE ASSISTANT MESSAGE
            # =================================================

            assistant_message = conversation.messages.create(
                role="assistant",
                content=(assistant_content),
            )

            return Response(
                {
                    "intent": intent,
                    "intent_summary": intent_summary,
                    "user_message": self._serialize_message(user_message),
                    "assistant_message": self._serialize_message(assistant_message),
                },
                status=(status.HTTP_201_CREATED),
            )

        except Exception as exc:
            print("\n" "========== PROJECT CHAT ERROR ==========")

            print(
                "PROJECT ID:",
                project.id,
            )

            print(
                "ERROR TYPE:",
                type(exc).__name__,
            )

            print(
                "ERROR:",
                str(exc),
            )

            traceback.print_exc()

            print("========================================" "\n")

            return Response(
                {
                    "error": ("AI response failed: " f"{str(exc)}"),
                    "error_type": type(exc).__name__,
                    "user_message": self._serialize_message(user_message),
                },
                status=(status.HTTP_502_BAD_GATEWAY),
            )

    @action(
        detail=True,
        methods=["post"],
        url_path="chat/regenerate",
    )
    def regenerate_chat_response(self, request, pk=None):
        project = self.get_object()
        conversation = project.get_or_create_main_conversation()

        message_id = request.data.get("message_id")

        try:
            user_message = conversation.messages.get(
                pk=message_id,
                role="user",
            )
        except (Message.DoesNotExist, ValueError, TypeError):
            return Response(
                {"error": "User message not found in this conversation."},
                status=status.HTTP_404_NOT_FOUND,
            )

        previous_assistant = conversation.messages.filter(
            role="assistant",
            created_at__gt=user_message.created_at,
        ).order_by("created_at").first()

        try:
            prompt = (
                f"Project: {project.name}\n"
                f"Original request: {project.initial_prompt}\n"
                f"Regenerate the assistant's response to this user message:\n"
                f"{user_message.content}"
            )

            response = AIChatService().send(prompt)
            content = response.content.strip()

            if not content:
                raise ValueError("The AI returned an empty response.")

            if previous_assistant:
                previous_assistant.content = content
                previous_assistant.save(update_fields=["content"])
                assistant_message = previous_assistant
            else:
                assistant_message = conversation.messages.create(
                    role="assistant",
                    content=content,
                )

            return Response(
                {
                    "assistant_message": self._serialize_message(
                        assistant_message
                    )
                },
                status=status.HTTP_200_OK,
            )

        except Exception as exc:
            traceback.print_exc()
            return Response(
                {"error": f"Unable to regenerate response: {exc}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )

    @action(
        detail=True,
        methods=["post"],
        url_path=r"chat/messages/(?P<message_id>\d+)/edit",
    )
    def edit_chat_message(self, request, pk=None, message_id=None):
        project = self.get_object()
        conversation = project.get_or_create_main_conversation()

        content = request.data.get("content", "").strip()

        if not content:
            return Response(
                {"error": "Message content cannot be empty."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            user_message = conversation.messages.get(
                pk=message_id,
                role="user",
            )
        except Message.DoesNotExist:
            return Response(
                {"error": "User message not found in this conversation."},
                status=status.HTTP_404_NOT_FOUND,
            )

        try:
            user_message.content = content
            user_message.save(update_fields=["content"])

            prompt = (
                f"Project: {project.name}\n"
                f"Original request: {project.initial_prompt}\n"
                f"Respond to this edited user message:\n{content}"
            )

            response = AIChatService().send(prompt)
            assistant_content = response.content.strip()

            if not assistant_content:
                raise ValueError("The AI returned an empty response.")

            assistant_message = conversation.messages.create(
                role="assistant",
                content=assistant_content,
            )

            return Response(
                {
                    "user_message": self._serialize_message(user_message),
                    "assistant_message": self._serialize_message(
                        assistant_message
                    ),
                },
                status=status.HTTP_200_OK,
            )

        except Exception as exc:
            traceback.print_exc()
            return Response(
                {"error": f"Unable to edit message: {exc}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )

    @action(
        detail=True,
        methods=["post"],
        url_path=r"changes/(?P<change_id>\d+)/approve",
    )
    def approve_project_change(
        self,
        request,
        pk=None,
        change_id=None,
    ):
        project = self.get_object()

        try:
            pending_change = PendingProjectChange.objects.get(
                pk=change_id,
                project=project,
                user=request.user,
            )
        except PendingProjectChange.DoesNotExist:
            return Response(
                {"error": "Change proposal not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if pending_change.status != PendingProjectChange.Status.PENDING:
            return Response(
                {
                    "error": "This proposal has already been processed.",
                    "status": pending_change.status,
                },
                status=status.HTTP_409_CONFLICT,
            )

        try:
            change_service = ProjectChangeService()

            change_result = change_service.apply(
                project=project,
                change_request=pending_change.request_text,
                affected_files=pending_change.affected_files,
                new_files=pending_change.new_files,
            )

            pending_change.status = PendingProjectChange.Status.APPLIED
            pending_change.save(update_fields=["status", "updated_at"])

            return Response(
                {
                    "message": "Approved change applied.",
                    "proposal_id": pending_change.id,
                    "summary": change_result.get("summary", pending_change.summary),
                    "written_files": change_result.get("written_files", []),
                    "status": pending_change.status,
                },
                status=status.HTTP_200_OK,
            )

        except Exception:
            traceback.print_exc()

            return Response(
                {
                    "error": (
                        "The change could not be applied. "
                        "Check the backend logs for details."
                    ),
                    "proposal_id": pending_change.id,
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    # =========================================================
    # PREVIEW LIFECYCLE
    # =========================================================

    @action(
        detail=True,
        methods=["get"],
        url_path="preview",
    )
    def preview_status(self, request, pk=None):
        project = self.get_object()

        result = preview_manager.get_status(project.id)

        return Response(result, status=status.HTTP_200_OK)

    @action(
        detail=True,
        methods=["post"],
        url_path="preview/start",
    )
    def start_preview(self, request, pk=None):
        project = self.get_object()
        workspace = self._workspace_root(project)

        try:
            result = preview_manager.start(
                project.id,
                workspace,
            )
            return Response(result, status=status.HTTP_202_ACCEPTED)

        except FileNotFoundError as exc:
            return Response(
                {"status": "failed", "error": str(exc)},
                status=status.HTTP_404_NOT_FOUND,
            )

        except Exception as exc:
            return Response(
                {"status": "failed", "error": str(exc)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(
        detail=True,
        methods=["post"],
        url_path="preview/stop",
    )
    def stop_preview(self, request, pk=None):
        project = self.get_object()

        result = preview_manager.stop(project.id)

        return Response(result, status=status.HTTP_200_OK)

    def perform_destroy(self, instance):
        """
        Delete the project's workspace and then its database record.
        """
        workspace = WorkspaceManager(instance)
        workspace_path = workspace.workspace_path
        workspace_root = workspace.root

        # Safety check: only delete a direct child of WORKSPACE_ROOT.
        if (
            workspace_path.parent != workspace_root
            or workspace_path == workspace_root
        ):
            raise ValueError("Invalid workspace path.")

        # Stop the project's preview before removing its files.
        preview_manager.stop(instance.id)

        if workspace_path.exists():
            if not workspace_path.is_dir():
                raise ValueError("Workspace path is not a directory.")

            shutil.rmtree(workspace_path)

        instance.delete()

    # =========================================================
    # SAVE PROJECT FILE
    # =========================================================

    @action(
        detail=True,
        methods=["post"],
        url_path="file/save",
    )
    def save_project_file(self, request, pk=None):
        project = self.get_object()

        relative_path = request.data.get("path")
        content = request.data.get("content")

        # Validate the request.
        if not isinstance(relative_path, str) or not relative_path.strip():
            return Response(
                {"error": "File path is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not isinstance(content, str):
            return Response(
                {"error": "File content must be a string."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            workspace = WorkspaceManager(project)

            if not workspace.exists():
                return Response(
                    {"error": "Project workspace does not exist."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            # Write the content to the requested workspace file.
            saved_path = workspace.write_file(
                relative_path=relative_path,
                content=content,
            )

            return Response(
                {
                    "success": True,
                    "message": "File saved successfully.",
                    "path": saved_path.relative_to(
                        workspace.workspace_path
                    ).as_posix(),
                },
                status=status.HTTP_200_OK,
            )

        except Exception as exc:
            print("FILE SAVE ERROR:", str(exc))
            traceback.print_exc()

            return Response(
                {
                    "success": False,
                    "error": str(exc),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )