from agents.providers.factory import (
    get_llm_provider,
)


class AIChatService:

    def __init__(self):
        self.llm = get_llm_provider()

    def send(
        self,
        message: str,
    ):

        messages = [
            {
                "role": "system",
                "content": (
                    "You are the AI engine for a "
                    "full-stack application builder."
                ),
            },
            {
                "role": "user",
                "content": message,
            },
        ]

        return self.llm.generate(
            messages,
            temperature=0.2,
        )