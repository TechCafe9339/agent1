from django.conf import settings
from django.db import models


class Project(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        PLANNING = "planning", "Planning"
        GENERATING = "generating", "Generating"
        BUILDING = "building", "Building"
        READY = "ready", "Ready"
        FAILED = "failed", "Failed"

    class GenerationMode(models.TextChoices):
        FRONTEND_PAGE = "frontend_page", "Frontend Page"
        FULL_STACK = "full_stack", "Full Stack"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="projects",
    )

    generation_mode = models.CharField(
        max_length=20,
        choices=GenerationMode.choices,
        default=GenerationMode.FRONTEND_PAGE,
    )

    name = models.CharField(max_length=255)

    description = models.TextField(blank=True)

    initial_prompt = models.TextField(blank=True)

    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.DRAFT,
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    updated_at = models.DateTimeField(
        auto_now=True,
    )

    def get_or_create_main_conversation(self):
        conversation, created = self.conversations.get_or_create(
            title="Main Development Chat"
        )

        return conversation

    def __str__(self):
        return self.name

class ApplicationSpecification(models.Model):
    project = models.OneToOneField(
        Project,
        on_delete=models.CASCADE,
        related_name="application_specification",
    )

    name = models.CharField(
        max_length=255,
    )

    description = models.TextField()

    application_type = models.CharField(
        max_length=100,
        default="web_application",
    )

    stack = models.JSONField(
        default=dict,
    )

    features = models.JSONField(
        default=list,
    )

    entities = models.JSONField(
        default=list,
    )

    pages = models.JSONField(
        default=list,
    )

    user_roles = models.JSONField(
        default=list,
    )

    assumptions = models.JSONField(
        default=list,
    )

    version = models.PositiveIntegerField(
        default=1,
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    updated_at = models.DateTimeField(
        auto_now=True,
    )

    def __str__(self):
        return (
            f"Specification for {self.project.name}"
        )


class PendingProjectChange(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPLIED = "applied", "Applied"
        REJECTED = "rejected", "Rejected"

    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        related_name="pending_changes",
    )

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="pending_project_changes",
    )

    request_text = models.TextField()
    summary = models.TextField(blank=True)
    affected_files = models.JSONField(default=list)
    new_files = models.JSONField(default=list)
    risk = models.CharField(max_length=20, default="medium")
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return (
            f"Change #{self.pk} for {self.project.name} "
            f"({self.status})"
        )
