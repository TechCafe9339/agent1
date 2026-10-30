from rest_framework import viewsets
from rest_framework.exceptions import PermissionDenied

from projects.models import Project

from .models import Conversation, Message
from .serializers import (
    ConversationSerializer,
    MessageSerializer,
)


class ConversationViewSet(viewsets.ModelViewSet):
    serializer_class = ConversationSerializer

    def get_queryset(self):
        return Conversation.objects.filter(
            project__user=self.request.user
        ).order_by("-created_at")

    def perform_create(self, serializer):
        project = serializer.validated_data["project"]

        if project.user != self.request.user:
            raise PermissionDenied(
                "You do not have permission to use this project."
            )

        serializer.save()


class MessageViewSet(viewsets.ModelViewSet):
    serializer_class = MessageSerializer

    def get_queryset(self):
        return Message.objects.filter(
            conversation__project__user=self.request.user
        ).order_by("created_at")

    def perform_create(self, serializer):
        conversation = serializer.validated_data["conversation"]

        if conversation.project.user != self.request.user:
            raise PermissionDenied(
                "You do not have permission to use this conversation."
            )

        serializer.save()