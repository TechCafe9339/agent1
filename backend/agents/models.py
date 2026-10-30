from django.db import models

from conversations.models import Message
from projects.models import Project


class AgentRun(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        RUNNING = "running", "Running"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"

    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        related_name="agent_runs",
    )

    trigger_message = models.ForeignKey(
        Message,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="agent_runs",
    )

    model_name = models.CharField(
        max_length=100,
        default="qwen3:8b",
    )

    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
    )

    error_message = models.TextField(
        blank=True,
    )

    started_at = models.DateTimeField(
        null=True,
        blank=True,
    )

    completed_at = models.DateTimeField(
        null=True,
        blank=True,
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    def __str__(self):
        return f"AgentRun {self.id} - {self.status}"

class ImplementationPlan(models.Model):
    project = models.OneToOneField(
        Project,
        on_delete=models.CASCADE,
        related_name="implementation_plan",
    )

    project_name = models.CharField(
        max_length=255,
    )

    summary = models.TextField()

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    updated_at = models.DateTimeField(
        auto_now=True,
    )

    def __str__(self):
        return f"Plan for {self.project.name}"


class PlanTask(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        RUNNING = "running", "Running"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"
        SKIPPED = "skipped", "Skipped"

    class TaskType(models.TextChoices):
        DATABASE = "database", "Database"
        BACKEND = "backend", "Backend"
        FRONTEND = "frontend", "Frontend"
        INTEGRATION = "integration", "Integration"
        BUILD = "build", "Build"

    plan = models.ForeignKey(
        ImplementationPlan,
        on_delete=models.CASCADE,
        related_name="tasks",
    )

    task_number = models.PositiveIntegerField()

    task_type = models.CharField(
        max_length=20,
        choices=TaskType.choices,
    )

    title = models.CharField(
        max_length=255,
    )

    description = models.TextField()

    dependencies = models.JSONField(
        default=list,
    )

    files = models.JSONField(
        default=list,
    )

    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
    )

    error_message = models.TextField(
        blank=True,
    )

    started_at = models.DateTimeField(
        null=True,
        blank=True,
    )

    completed_at = models.DateTimeField(
        null=True,
        blank=True,
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    updated_at = models.DateTimeField(
        auto_now=True,
    )

    class Meta:
        ordering = ["task_number"]

        constraints = [
            models.UniqueConstraint(
                fields=[
                    "plan",
                    "task_number",
                ],
                name="unique_task_number_per_plan",
            )
        ]

    def __str__(self):
        return (
            f"{self.task_number}. "
            f"{self.title}"
        )


class AgentLesson(models.Model):
    stack = models.CharField(max_length=100, db_index=True)
    error_signature = models.CharField(max_length=255, db_index=True)
    error_message = models.TextField()
    root_cause = models.TextField()
    solution = models.TextField()
    affected_files = models.JSONField(default=list, blank=True)

    verified = models.BooleanField(default=False, db_index=True)
    success_count = models.PositiveIntegerField(default=0)
    failure_count = models.PositiveIntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-success_count", "-updated_at"]

    def __str__(self):
        return f"{self.stack}: {self.error_signature}"
