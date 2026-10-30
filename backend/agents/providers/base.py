from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class LLMResponse:
    content: str


class LLMProvider(ABC):

    @abstractmethod
    def generate(
        self,
        messages: list[dict],
        *,
        temperature: float = 0.1,
        json_mode: bool = False,
        json_schema: dict | None = None,
    ) -> LLMResponse:
        raise NotImplementedError