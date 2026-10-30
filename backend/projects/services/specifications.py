from django.db import transaction

from agents.schemas.requirements import (
    ApplicationSpecification as ApplicationSpecificationSchema,
)

from projects.models import (
    ApplicationSpecification,
    Project,
)


class ApplicationSpecificationService:

    @staticmethod
    @transaction.atomic
    def save(
        *,
        project: Project,
        specification: ApplicationSpecificationSchema,
    ) -> ApplicationSpecification:

        data = specification.model_dump()

        database_specification, created = (
            ApplicationSpecification.objects.update_or_create(
                project=project,
                defaults={
                    "name": data["name"],
                    "description": data["description"],
                    "application_type": data[
                        "application_type"
                    ],
                    "stack": data["stack"],
                    "features": data["features"],
                    "entities": data["entities"],
                    "pages": data["pages"],
                    "user_roles": data["user_roles"],
                    "assumptions": data["assumptions"],
                },
            )
        )

        if not created:
            database_specification.version += 1

            database_specification.save(
                update_fields=[
                    "version",
                    "updated_at",
                ]
            )

        return database_specification