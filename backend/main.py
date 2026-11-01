import asyncio
from contextlib import asynccontextmanager, suppress

import httpx
from redis.asyncio import Redis
from backend.services.auth import AuthService
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.config import get_settings
from backend.database import engine
from backend.router import router
from backend.services.ai_inference import AIInferenceService
from backend.services.sessions import SessionService
from backend.services.evaluation import recover_interrupted, reap_expired

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    redis = Redis.from_url(settings.redis_url, decode_responses=True, socket_connect_timeout=3, socket_timeout=3)
    app.state.auth = AuthService(redis)
    await recover_interrupted()
    app.state.game_session = SessionService()
    async with httpx.AsyncClient(timeout=settings.ai_timeout_seconds, trust_env=False) as client:
        app.state.ai = AIInferenceService(client, settings)
        reaper = asyncio.create_task(reap_expired())
        try:
            yield
        finally:
            reaper.cancel()
            with suppress(asyncio.CancelledError):
                await reaper
            await redis.aclose()
            await engine.dispose()


app = FastAPI(title="Interview Game Backend", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["Content-Type", "Authorization"],
)

app.include_router(router)
