from django.db import transaction

from workspaces.manager import WorkspaceManager

from .models import Project


class ProjectService:

    @staticmethod
    @transaction.atomic
    def create_project(
        *,
        user,
        name,
        description="",
        initial_prompt="",
    ):

        project = Project.objects.create(
            user=user,
            name=name,
            description=description,
            initial_prompt=initial_prompt,
        )

        workspace = WorkspaceManager(
            project
        )

        workspace.create()

        return project