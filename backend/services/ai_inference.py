import asyncio

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

    async def chat(self, prompt: str, message: str) -> str:
        async with self.qwen_slots:
            result = await self._request(self.settings.qwen_url, json={
                "model": self.settings.qwen_model,
                "messages": [
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": message},
                ],
                "max_tokens": 192,
                "temperature": 0.7,
                "stream": False,
                "chat_template_kwargs": {"enable_thinking": False},
            })
        try:
            reply = result["choices"][0]["message"]["content"]
            if not isinstance(reply, str) or not reply.strip():
                raise ValueError("Empty reply")
            return reply.strip()
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise HTTPException(502, "Qwen вернул ответ без текста") from exc

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
