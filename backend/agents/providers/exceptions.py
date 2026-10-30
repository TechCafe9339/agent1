class LLMError(Exception):
    """Base LLM provider error."""


class LLMConnectionError(LLMError):
    """Unable to connect to LLM provider."""


class LLMGenerationError(LLMError):
    """LLM failed during generation."""