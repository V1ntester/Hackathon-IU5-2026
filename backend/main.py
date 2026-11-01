from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.config import get_settings
from backend.database import engine
from backend.router import router
from backend.services.ai_inference import AIInferenceService
from backend.services.sessions import SessionService

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.game_session = SessionService()
    async with httpx.AsyncClient(timeout=settings.ai_timeout_seconds, trust_env=False) as client:
        app.state.ai = AIInferenceService(client, settings)
        try:
            yield
        finally:
            await engine.dispose()


app = FastAPI(title="Interview Game Backend", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["Content-Type"],
)

app.include_router(router)
