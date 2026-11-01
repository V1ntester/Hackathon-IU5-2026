import asyncio
import json
from fastapi import HTTPException
import ipaddress
from contextlib import suppress
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import APIRouter, WebSocket
from pydantic import ValidationError
from starlette.websockets import WebSocketDisconnect

from backend.dtos import ServerEvent
from backend.config import get_settings
from backend.database import session_factory
from backend.router.commands import parse_command, parse_fps_report, parse_pong
from backend.services.players import PlayerService
from backend.services.sessions import ObjectNotFoundError, SessionParticipant, SessionService

settings = get_settings()

router = APIRouter(tags=["sessions"])


def _origin_allowed(origin: str) -> bool:
    if origin in settings.cors_origins:
        return True
    if not settings.allow_lan_websocket_origins:
        return False
    try:
        parsed = urlsplit(origin)
        address = ipaddress.ip_address(parsed.hostname or "")
        return (
            parsed.scheme == "http"
            and parsed.port == 5173
            and address.is_private
            and not address.is_reserved
            and not address.is_loopback
            and not address.is_link_local
        )
    except ValueError:
        return False


@router.websocket("/ws/{player_id}")
async def websocket_endpoint(websocket: WebSocket, player_id: UUID):
    origin = websocket.headers.get("origin")
    if origin is not None and not _origin_allowed(origin):
        await websocket.close(code=1008)
        return
    token = websocket.query_params.get("session_id")
    try:
        owner = await websocket.app.state.auth.resolve(token)
        if owner != str(player_id):
            raise HTTPException(403)
    except HTTPException:
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
    peer.session_id = token
    game_session: SessionService = websocket.app.state.game_session
    if not game_session.connect(peer):
        await websocket.close(code=1008, reason="Игрок уже подключён")
        return
    sender = asyncio.create_task(peer.send_snapshots())
    heartbeat = asyncio.create_task(game_session.heartbeat(peer))
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
                payload = json.loads(raw)
                if not isinstance(payload, dict) or payload.pop("session_id", None) != token:
                    raise HTTPException(401)
                if await websocket.app.state.auth.resolve(token) != str(player_id):
                    raise HTTPException(401)
                raw = json.dumps(payload)
            except (ValueError, HTTPException):
                await websocket.close(code=1008, reason="Сессия недействительна")
                break
            try:
                command = parse_command(raw)
            except ValidationError:
                try:
                    pong = parse_pong(raw)
                except ValidationError:
                    try:
                        fps_report = parse_fps_report(raw)
                    except ValidationError:
                        await websocket.close(code=1008, reason="Некорректная команда")
                        break
                    game_session.record_fps(peer, fps_report)
                    continue
                game_session.record_pong(peer, pong)
                continue
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
        heartbeat.cancel()
        with suppress(asyncio.CancelledError):
            await asyncio.gather(sender, heartbeat)
