
import re

from rest_framework import serializers

from .models import Project


class ProjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = Project

        fields = [
            "id",
            "name",
            "description",
            "initial_prompt",
            "status",
            "created_at",
            "updated_at",
        ]

        read_only_fields = [
            "id",
            "status",
            "created_at",
            "updated_at",
        ]

        extra_kwargs = {
            "name": {
                "required": False,
            },
        }

    def validate_initial_prompt(self, value):
        value = value.strip()

        if not value:
            raise serializers.ValidationError(
                "Project prompt cannot be empty."
            )

        return value

    def create(self, validated_data):
        prompt = validated_data["initial_prompt"]

        if not validated_data.get("name"):
            validated_data["name"] = self.generate_project_name(prompt)

        return super().create(validated_data)

    @staticmethod
    def generate_project_name(prompt):
        text = prompt.lower().strip()

        # Remove common instruction words.
        text = re.sub(
            r"^(please\s+)?(make|create|build|develop|generate)\s+",
            "",
            text,
        )

        # Remove common leading articles.
        text = re.sub(r"^(a|an|the)\s+", "", text)

        # Keep the main purpose before extra details.
        text = re.split(
            r"\b(with|using|that|which|for|including)\b",
            text,
            maxsplit=1,
        )[0]

        # Convert to a clean underscore-separated name.
        words = re.findall(r"[a-z0-9]+", text)

        return "_".join(words[:5]) or "untitled_project"
