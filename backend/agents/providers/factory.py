from .base import LLMProvider
from .qwen import QwenProvider


def get_llm_provider() -> LLMProvider:
    return QwenProvider()