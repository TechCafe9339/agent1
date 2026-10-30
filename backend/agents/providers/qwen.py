
import os
import time
import logging

import requests
from django.conf import settings

from .base import LLMProvider, LLMResponse
from .exceptions import LLMConnectionError, LLMGenerationError

logger = logging.getLogger(__name__)


class QwenProvider(LLMProvider):

    def __init__(self):
        self.base_url = settings.QWEN_BASE_URL.rstrip("/")
        self.model = settings.QWEN_MODEL

        self.timeout = int(os.getenv("QWEN_TIMEOUT", "600"))
        self.num_predict = int(os.getenv("QWEN_NUM_PREDICT", "4096"))
        self.num_ctx = int(os.getenv("QWEN_NUM_CTX", "4096"))
        self.think = os.getenv("QWEN_THINK", "false").lower() == "true"

    def generate(
        self,
        messages: list[dict],
        *,
        temperature: float = 0.1,
        json_mode: bool = False,
        json_schema: dict | None = None,
    ) -> LLMResponse:

        url = f"{self.base_url}/api/chat"

        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "think": self.think,
            "options": {
                "temperature": temperature,
                "num_ctx": self.num_ctx,
                "num_predict": self.num_predict,
            },
        }

        if json_schema is not None:
            payload["format"] = json_schema
        elif json_mode:
            payload["format"] = "json"

        started = time.monotonic()

        try:
            response = requests.post(
                url,
                json=payload,
                timeout=(10, self.timeout),
            )
            response.raise_for_status()
            data = response.json()

        except requests.Timeout as exc:
            elapsed = time.monotonic() - started
            logger.exception(
                "Ollama timed out after %.1f seconds; model=%s",
                elapsed,
                self.model,
            )
            raise LLMGenerationError(
                f"Ollama generation timed out after {elapsed:.1f}s "
                f"using {self.model}."
            ) from exc

        except requests.ConnectionError as exc:
            logger.exception("Could not connect to Ollama at %s", url)
            raise LLMConnectionError(
                f"Could not connect to Ollama at {url}."
            ) from exc

        except requests.RequestException as exc:
            logger.exception("Ollama request failed")
            raise LLMGenerationError(
                f"Ollama request failed: {exc}"
            ) from exc

        elapsed = time.monotonic() - started

        message = data.get("message", {})
        content = message.get("content", "")

        logger.info(
            "Ollama generation completed | model=%s | elapsed=%.1fs "
            "| done_reason=%s | prompt_tokens=%s | output_tokens=%s "
            "| output_chars=%s | num_predict=%s | num_ctx=%s",
            self.model,
            elapsed,
            data.get("done_reason", "unknown"),
            data.get("prompt_eval_count", "unknown"),
            data.get("eval_count", "unknown"),
            len(content),
            self.num_predict,
            self.num_ctx,
        )

        content = data.get("message", {}).get("content", "")

        if not content.strip():
            raise LLMGenerationError(
                f"Ollama returned an empty response using {self.model}."
            )

        return LLMResponse(content=content)


# import requests, os

# from django.conf import settings

# from .base import (
#     LLMProvider,
#     LLMResponse,
# )

# from .exceptions import (
#     LLMConnectionError,
#     LLMGenerationError,
# )


# class QwenProvider(LLMProvider):

#     def __init__(self):
#         self.base_url = settings.QWEN_BASE_URL.rstrip("/")

#         self.model = settings.QWEN_MODEL

#         self.timeout = int(
#             os.getenv(
#                 "QWEN_TIMEOUT",
#                 "600",
#             )
#         )

#     def generate(
#         self,
#         messages: list[dict],
#         *,
#         temperature: float = 0.1,
#         json_mode: bool = False,
#         json_schema: dict | None = None,
#     ) -> LLMResponse:

#         url = f"{self.base_url}/api/chat"

#         payload = {
#             "model": self.model,
#             "messages": messages,
#             "stream": False,
#             "options": {
#                 "temperature": temperature,
#             },
#         }

#         if json_schema is not None:
#             payload["format"] = json_schema

#         elif json_mode:
#             payload["format"] = "json"

#         response = requests.post(
#             url,
#             json=payload,
#             timeout=(
#                 10,
#                 self.timeout,
#             ),
#         )

#         response.raise_for_status()

#         data = response.json()

#         content = data.get("message", {}).get("content", "")

#         return LLMResponse(content=content)


