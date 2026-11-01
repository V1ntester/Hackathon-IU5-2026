import asyncio
from typing import Literal
from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException

from backend.config import Settings

AUDIO_FORMATS = {
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/webm": "webm",
    "video/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/flac": "flac",
}


class AIInferenceService:
    def __init__(self, client: httpx.AsyncClient, settings: Settings):
        self.client = client
        self.settings = settings
        self.qwen_slots = asyncio.Semaphore(1)
        self.whisper_slots = asyncio.Semaphore(2)
        parsed = urlsplit(settings.qwen_url)
        self.llama_base = f"{parsed.scheme}://{parsed.netloc}"

    async def _request(self, url: str, **kwargs) -> dict:
        try:
            response = await self.client.post(url, **kwargs)
            response.raise_for_status()
            result = response.json()
            if not isinstance(result, dict):
                raise ValueError("Expected JSON object")
            return result
        except httpx.TimeoutException as exc:
            raise HTTPException(504, "Локальный ИИ-сервис не ответил вовремя") from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise HTTPException(502, "Ошибка ответа локального ИИ-сервиса") from exc

    async def context_limit(self) -> int:
        try:
            async with self.qwen_slots:
                response = await self.client.get(f"{self.llama_base}/props")
            response.raise_for_status()
            actual = response.json()["default_generation_settings"]["n_ctx"]
            if type(actual) is not int or actual <= 0:
                raise ValueError("Invalid n_ctx")
            return min(actual, self.settings.qwen_context_tokens)
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            raise HTTPException(502, "Не удалось подтвердить контекст llama.cpp через /props") from exc

    async def count_tokens(self, messages: list[dict], tools: list[dict] | None = None,
                           tool_choice: Literal["auto", "required"] = "auto") -> int:
        payload = {
            "messages": messages, "add_generation_prompt": True,
            "chat_template_kwargs": {"enable_thinking": False},
        }
        if tools is not None:
            payload["tools"] = tools
            payload["tool_choice"] = tool_choice
            payload["parallel_tool_calls"] = False
        async with self.qwen_slots:
            rendered = await self._request(f"{self.llama_base}/apply-template", json=payload)
            prompt = rendered.get("prompt")
            if not isinstance(prompt, str) or not prompt:
                raise HTTPException(502, "llama.cpp не вернул chat template")
            result = await self._request(f"{self.llama_base}/tokenize", json={
                "content": prompt, "add_special": True, "parse_special": True,
            })
        tokens = result.get("tokens")
        if not isinstance(tokens, list) or not tokens or not all(type(t) is int for t in tokens):
            raise HTTPException(502, "llama.cpp не вернул токены")
        return len(tokens)

    async def generate(self, messages: list[dict], reserve: int = 192, temperature: float = 0.7) -> str:
        assistant_message = await self.chat_completion(messages, reserve=reserve, temperature=temperature)
        return assistant_message["content"].strip()

    async def chat_completion(
        self,
        messages: list[dict],
        tools: list[dict] | None = None,
        *,
        reserve: int = 192,
        temperature: float = 0.7,
        tool_choice: Literal["auto", "required"] = "auto",
    ) -> dict:
        payload = {
            "model": self.settings.qwen_model,
            "messages": messages,
            "max_tokens": reserve,
            "temperature": temperature,
            "stream": False,
            "chat_template_kwargs": {"enable_thinking": False},
        }
        if tools is not None:
            payload["tools"] = tools
            payload["tool_choice"] = tool_choice
            payload["parallel_tool_calls"] = False
            if tool_choice == "required":
                # Выбор действия не должен зависеть от прогретого KV-префикса
                # предыдущей реплики. Обычные ответы и оценки сохраняют настройки.
                payload["cache_prompt"] = False

        async with self.qwen_slots:
            result = await self._request(self.settings.qwen_url, json=payload)
        try:
            choice = result["choices"][0]
            if choice["finish_reason"] not in ("stop", "tool_calls"):
                raise ValueError("Incomplete generation")
            assistant_message = choice["message"]
            if not isinstance(assistant_message, dict):
                raise ValueError("Invalid assistant message")
            content = assistant_message.get("content")
            if content is not None and not isinstance(content, str):
                raise ValueError("Invalid assistant content")
            calls = assistant_message.get("tool_calls")
            if calls is not None and not isinstance(calls, list):
                raise ValueError("Invalid tool calls")
            if calls:
                if tools is None:
                    raise ValueError("Unexpected tool call")
                for call in calls:
                    if not isinstance(call, dict) or call.get("type") != "function":
                        raise ValueError("Invalid tool call")
                    if not isinstance(call.get("id"), str) or not call["id"].strip():
                        raise ValueError("Missing tool call ID")
                    function = call.get("function")
                    if (not isinstance(function, dict)
                        or not isinstance(function.get("name"), str)
                        or not isinstance(function.get("arguments"), str)):
                        raise ValueError("Invalid function call")
            else:
                if tool_choice == "required":
                    raise ValueError("Required tool call is missing")
                reply = assistant_message.get("content")
                if choice["finish_reason"] != "stop" or not isinstance(reply, str) or not reply.strip():
                    raise ValueError("Empty reply")
            return assistant_message
        except (KeyError, IndexError, TypeError, ValueError, AttributeError) as exc:
            raise HTTPException(502, "Qwen вернул пустой, некорректный или незавершённый ответ") from exc

    async def chat(self, prompt: str, message: str) -> str:
        return await self.generate([
            {"role": "system", "content": prompt},
            {"role": "user", "content": message},
        ])

    async def transcribe(self, audio: bytes, content_type: str, language: str = "auto") -> str:
        async with self.whisper_slots:
            result = await self._request(self.settings.whisper_url,
                files={"file": (f"recording.{AUDIO_FORMATS[content_type]}", audio, content_type)},
                data={"response_format": "json", "language": language},
            )
        value = result.get("text")
        if not isinstance(value, str):
            raise HTTPException(502, "Whisper вернул ответ без текста")
        return value.strip()
