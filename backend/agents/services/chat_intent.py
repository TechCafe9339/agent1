import json

from agents.providers.factory import (
    get_llm_provider,
)


class ProjectChatIntentService:

    def __init__(self):
        self.llm = (
            get_llm_provider()
        )

    def classify(
        self,
        message: str,
    ) -> dict:

        schema = {
            "type": "object",
            "properties": {
                "intent": {
                    "type": "string",
                    "enum": [
                        "question",
                        "change_request",
                    ],
                },
                "summary": {
                    "type": "string",
                },
            },
            "required": [
                "intent",
                "summary",
            ],
            "additionalProperties":
                False,
        }

        messages = [
            {
                "role": "system",
                "content": (
                    "You classify messages sent "
                    "to an AI software development "
                    "assistant.\n\n"

                    "Return question when the user "
                    "only wants information, "
                    "explanation, clarification, "
                    "or advice.\n\n"

                    "Return change_request when "
                    "the user wants the existing "
                    "software project changed, "
                    "including adding, removing, "
                    "fixing, redesigning, updating, "
                    "or modifying functionality "
                    "or code."
                ),
            },
            {
                "role": "user",
                "content": message,
            },
        ]

        response = (
            self.llm.generate(
                messages,
                temperature=0,
                json_schema=schema,
            )
        )

        result = json.loads(
            response.content
        )

        return result