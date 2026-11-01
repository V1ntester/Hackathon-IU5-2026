import asyncio
from contextlib import asynccontextmanager, suppress
from typing import Annotated
from uuid import UUID

import httpx
from fastapi import Depends, FastAPI, File, Form, Request, UploadFile, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.websockets import WebSocketDisconnect

from backend.services.ai_inference import AIInferenceService
from backend.config import get_settings
from backend.database import engine, get_session, session_factory
from backend.services.players import PlayerService
from backend.services.scenarios import ScenarioService
from backend.services.practice import PracticeService
from backend.services.sessions import SessionParticipant, SessionService
from backend.dtos import (
    ChatRequest, ChatResponse, MoveMessage, PlayerCreate, PlayerRead,
    ScenarioRead, StatsRead, TranscriptionResponse,
)

settings = get_settings()
Session = Annotated[AsyncSession, Depends(get_session)]


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
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.post("/api/players", response_model=PlayerRead, status_code=201)
async def create_player(body: PlayerCreate, session: Session):
    return await PlayerService(session).create(body.display_name)


@app.get("/api/players/{player_id}/stats", response_model=StatsRead)
async def player_stats(player_id: UUID, session: Session):
    return await PlayerService(session).stats(str(player_id))


@app.get("/api/scenarios", response_model=list[ScenarioRead])
async def scenarios(session: Session):
    return await ScenarioService(session).list()


@app.post("/api/ai/chat", response_model=ChatResponse)
async def chat(body: ChatRequest, request: Request, session: Session):
    reply = await PracticeService(session, request.app.state.ai, settings).chat(
        body.player_id, body.scenario_id, body.message,
    )
    return ChatResponse(reply=reply)


@app.post("/api/ai/transcribe", response_model=TranscriptionResponse)
async def transcribe(
    request: Request,
    session: Session,
    player_id: Annotated[UUID, Form()],
    file: Annotated[UploadFile, File()],
):
    text = await PracticeService(session, request.app.state.ai, settings).transcribe(
        str(player_id), file,
    )
    return TranscriptionResponse(text=text)


@app.websocket("/ws/{player_id}")
async def websocket_endpoint(websocket: WebSocket, player_id: UUID):
    origin = websocket.headers.get("origin")
    if origin is not None and origin not in settings.cors_origins:
        await websocket.close(code=1008)
        return
    async with session_factory() as session:
        player = await PlayerService(session).find(str(player_id))
        if player is None:
            await websocket.close(code=1008)
            return
        display_name = player.display_name

    await websocket.accept()
    peer = SessionParticipant(websocket, str(player_id), display_name)
    game_session: SessionService = websocket.app.state.game_session
    if not game_session.connect(peer):
        await websocket.close(code=1008, reason="Игрок уже подключён")
        return
    sender = asyncio.create_task(peer.send_snapshots())
    try:
        async with session_factory() as session:
            await PlayerService(session).record_connection(str(player_id))
        while True:
            event = await websocket.receive()
            if event["type"] == "websocket.disconnect":
                break
            raw = event.get("text")
            if raw is None:
                await websocket.close(code=1008, reason="Ожидается текстовый JSON")
                break
            if len(raw) > 4096:
                await websocket.close(code=1009)
                break
            try:
                message = MoveMessage.model_validate_json(raw)
            except ValidationError:
                await websocket.close(code=1008, reason="Некорректное сообщение move")
                break
            game_session.move(peer, message)
    except WebSocketDisconnect:
        pass
    finally:
        game_session.disconnect(peer)
        sender.cancel()
        with suppress(asyncio.CancelledError):
            await sender
