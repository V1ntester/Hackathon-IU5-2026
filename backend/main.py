import asyncio
from contextlib import asynccontextmanager, suppress
from typing import Annotated
from uuid import UUID

import httpx
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.websockets import WebSocketDisconnect

from backend.ai import AIService, AUDIO_FORMATS
from backend.config import get_settings
from backend.database import engine, get_session, session_factory
from backend.models import PlayerStats, Scenario, User
from backend.realtime import Peer, World
from backend.dtos import (
    ChatRequest, ChatResponse, MoveMessage, PlayerCreate, PlayerRead,
    ScenarioRead, StatsRead, TranscriptionResponse,
)

settings = get_settings()
Session = Annotated[AsyncSession, Depends(get_session)]


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.world = World()
    async with httpx.AsyncClient(timeout=settings.ai_timeout_seconds, trust_env=False) as client:
        app.state.ai = AIService(client, settings)
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


async def require_player(session: AsyncSession, player_id: str) -> User:
    player = await session.get(User, player_id)
    if player is None:
        raise HTTPException(404, "Игрок не найден")
    return player


@app.post("/api/players", response_model=PlayerRead, status_code=201)
async def create_player(body: PlayerCreate, session: Session):
    player = User(display_name=body.display_name)
    session.add(player)
    await session.flush()
    session.add(PlayerStats(user_id=player.id))
    await session.commit()
    return player


@app.get("/api/players/{player_id}/stats", response_model=StatsRead)
async def player_stats(player_id: UUID, session: Session):
    await require_player(session, str(player_id))
    return await session.get(PlayerStats, str(player_id))


@app.get("/api/scenarios", response_model=list[ScenarioRead])
async def scenarios(session: Session):
    return (await session.scalars(select(Scenario).order_by(Scenario.id))).all()


@app.post("/api/ai/chat", response_model=ChatResponse)
async def chat(body: ChatRequest, request: Request, session: Session):
    await require_player(session, body.player_id)
    scenario = await session.get(Scenario, body.scenario_id)
    if scenario is None:
        raise HTTPException(404, "Сценарий не найден")
    prompt = scenario.system_prompt
    # Не держим транзакцию БД во время долгой генерации.
    await session.rollback()
    reply = await request.app.state.ai.chat(prompt, body.message)
    await session.execute(update(PlayerStats).where(PlayerStats.user_id == body.player_id)
                          .values(text_requests=PlayerStats.text_requests + 1))
    await session.commit()
    return ChatResponse(reply=reply)


@app.post("/api/ai/transcribe", response_model=TranscriptionResponse)
async def transcribe(
    request: Request,
    session: Session,
    player_id: Annotated[UUID, Form()],
    file: Annotated[UploadFile, File()],
):
    try:
        await require_player(session, str(player_id))
        await session.rollback()
        # Читаем не более лимита + 1 байт, постоянную копию аудио не создаём.
        audio = await file.read(settings.max_audio_bytes + 1)
        if len(audio) > settings.max_audio_bytes:
            raise HTTPException(413, "Аудиофайл превышает допустимый размер")
        if not audio:
            raise HTTPException(422, "Аудиофайл пуст")
        content_type = (file.content_type or "").split(";", 1)[0].strip().lower()
        if content_type not in AUDIO_FORMATS:
            raise HTTPException(415, "Неподдерживаемый формат аудио")
        if AUDIO_FORMATS[content_type] == "wav" and (
            len(audio) < 12 or audio[:4] != b"RIFF" or audio[8:12] != b"WAVE"
        ):
            raise HTTPException(415, "Некорректный заголовок WAV")
        text = await request.app.state.ai.transcribe(audio, content_type)
        await session.execute(update(PlayerStats).where(PlayerStats.user_id == str(player_id))
                              .values(voice_requests=PlayerStats.voice_requests + 1))
        await session.commit()
        return TranscriptionResponse(text=text)
    finally:
        await file.close()


@app.websocket("/ws/{player_id}")
async def websocket_endpoint(websocket: WebSocket, player_id: UUID):
    origin = websocket.headers.get("origin")
    if origin is not None and origin not in settings.cors_origins:
        await websocket.close(code=1008)
        return
    async with session_factory() as session:
        player = await session.get(User, str(player_id))
        if player is None:
            await websocket.close(code=1008)
            return
        display_name = player.display_name

    await websocket.accept()
    peer = Peer(websocket, str(player_id), display_name)
    world: World = websocket.app.state.world
    if not world.connect(peer):
        await websocket.close(code=1008, reason="Игрок уже подключён")
        return
    sender = asyncio.create_task(peer.send_snapshots())
    try:
        async with session_factory() as session:
            await session.execute(update(PlayerStats).where(PlayerStats.user_id == str(player_id))
                                  .values(connections=PlayerStats.connections + 1))
            await session.commit()
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
            world.move(peer, message)
    except WebSocketDisconnect:
        pass
    finally:
        world.disconnect(peer)
        sender.cancel()
        with suppress(asyncio.CancelledError):
            await sender
