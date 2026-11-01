import asyncio
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

    async def count_tokens(self, messages: list[dict]) -> int:
        async with self.qwen_slots:
            rendered = await self._request(f"{self.llama_base}/apply-template", json={
                "messages": messages, "add_generation_prompt": True,
                "chat_template_kwargs": {"enable_thinking": False},
            })
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
        async with self.qwen_slots:
            result = await self._request(self.settings.qwen_url, json={
                "model": self.settings.qwen_model,
                "messages": messages,
                "max_tokens": reserve,
                "temperature": temperature,
                "stream": False,
                "chat_template_kwargs": {"enable_thinking": False},
            })
        try:
            if result["choices"][0].get("finish_reason") != "stop":
                raise ValueError("Incomplete generation")
            reply = result["choices"][0]["message"]["content"]
            if not isinstance(reply, str) or not reply.strip():
                raise ValueError("Empty reply")
            return reply.strip()
        except (KeyError, IndexError, TypeError, ValueError, AttributeError) as exc:
            raise HTTPException(502, "Qwen вернул пустой, некорректный или незавершённый ответ") from exc

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
