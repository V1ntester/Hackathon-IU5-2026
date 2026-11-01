from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://game:game@localhost:5435/interview_game"
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    allow_lan_websocket_origins: bool = False
    qwen_url: str = "http://localhost:8081/v1/chat/completions"
    qwen_model: str = "Qwen3-0.6B"
    whisper_url: str = "http://localhost:8082/inference"
    ai_timeout_seconds: float = Field(default=120, gt=0)
    max_audio_bytes: int = Field(default=10 * 1024 * 1024, gt=0)


@lru_cache
def get_settings() -> Settings:
    return Settings()
