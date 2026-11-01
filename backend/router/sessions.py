import asyncio
from contextlib import suppress
from uuid import UUID

from fastapi import APIRouter, WebSocket
from pydantic import ValidationError
from starlette.websockets import WebSocketDisconnect

from backend.dtos import ServerEvent
from backend.config import get_settings
from backend.database import session_factory
from backend.router.commands import parse_command
from backend.services.players import PlayerService
from backend.services.sessions import ObjectNotFoundError, SessionParticipant, SessionService

settings = get_settings()

router = APIRouter(tags=["sessions"])


@router.websocket("/ws/{player_id}")
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
                command = parse_command(raw)
            except ValidationError:
                await websocket.close(code=1008, reason="Некорректная команда")
                break
            try:
                game_session.handle_command(peer, command)
            except ObjectNotFoundError as exc:
                await peer.send_event(ServerEvent(
                    name="command_rejected",
                    payload={"command": command.type, "code": "object_not_found", "object_id": str(exc)},
                ))
    except WebSocketDisconnect:
        pass
    finally:
        game_session.disconnect(peer)
        sender.cancel()
        with suppress(asyncio.CancelledError):
            await sender
