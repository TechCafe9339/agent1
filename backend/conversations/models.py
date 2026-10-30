from django.conf import settings
from django.db import models

from projects.models import Project


class Conversation(models.Model):
    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        related_name="conversations",
    )

    title = models.CharField(
        max_length=255,
        blank=True,
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    updated_at = models.DateTimeField(
        auto_now=True,
    )

    is_main = models.BooleanField(
        default=False,
    )

    def get_or_create_main_conversation(self):
        conversation, created = self.conversations.get_or_create(
            is_main=True,
            defaults={
                "title": "Main Development Chat",
            },
        )
        return conversation

    def __str__(self):
        return self.title or f"Conversation {self.id}"


class Message(models.Model):
    class Role(models.TextChoices):
        USER = "user", "User"
        ASSISTANT = "assistant", "Assistant"
        SYSTEM = "system", "System"
        TOOL = "tool", "Tool"

    conversation = models.ForeignKey(
        Conversation,
        on_delete=models.CASCADE,
        related_name="messages",
    )

    role = models.CharField(
        max_length=20,
        choices=Role.choices,
    )

    content = models.TextField()

    metadata = models.JSONField(
        default=dict,
        blank=True,
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    def __str__(self):
        return f"{self.role}: {self.content[:50]}"