import asyncio
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from time import monotonic
from uuid import uuid4

from fastapi import WebSocket
from starlette.websockets import WebSocketDisconnect

from backend.dtos import AdminConnectionRead, ClientFpsReport, ClientPong, ServerEvent, WorldObjectRead
from backend.models.world_object import ObjectState, WorldObject
from backend.dtos.commands import Command, InteractCommand, MoveCommand


class ObjectNotFoundError(LookupError):
    pass


@dataclass
class SessionParticipant:
    websocket: WebSocket
    player_id: str
    display_name: str
    session_id: str | None = None
    position: dict = field(default_factory=lambda: {"x": 0.0, "y": 0.0, "z": 0.0})
    rotation_y: float = 0.0
    connected_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    ping_ms: float | None = None
    fps: float | None = None
    fps_updated_at: float | None = None
    last_fps_report_at: float = float("-inf")
    pending_ping_nonce: str | None = None
    pending_ping_started_at: float | None = None
    last_interaction_object_id: str | None = None
    last_move: float = float("-inf")
    snapshots: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=1))

    send_lock: asyncio.Lock = field(default_factory=asyncio.Lock, repr=False)

    async def _send(self, message: dict) -> None:
        # Serialize events and snapshots on the same WebSocket.
        async with self.send_lock:
            await asyncio.wait_for(self.websocket.send_json(message), timeout=5)

    async def send_event(self, event: ServerEvent) -> bool:
        try:
            await self._send(event.model_dump(mode="json"))
            return True
        except (OSError, RuntimeError, asyncio.TimeoutError, WebSocketDisconnect):
            await self._close_failed_connection()
            return False

    async def _close_failed_connection(self) -> None:
        try:
            await self.websocket.close(code=1011)
        except (OSError, RuntimeError, WebSocketDisconnect):
            pass

    async def send_snapshots(self):
        try:
            while True:
                snapshot = await self.snapshots.get()
                await self._send(snapshot)
        except (OSError, RuntimeError, asyncio.TimeoutError, WebSocketDisconnect):
            # Закрытие будит receive в обработчике, который удаляет игрока.
            await self._close_failed_connection()


class SessionService:
    """Одна общая игровая сессия на процесс; методы без await атомарны в event loop."""

    def __init__(self, objects: Iterable[WorldObject] | None = None):
        initial_objects = list(objects) if objects is not None else [WorldObject(id="office-light", state=ObjectState.ACTIVE)]
        self.objects: dict[str, WorldObject] = {}
        for obj in initial_objects:
            if not obj.id.strip() or len(obj.id) > 100 or obj.id != obj.id.strip():
                raise ValueError("Invalid world object ID")
            if obj.id in self.objects:
                raise ValueError(f"Duplicate world object ID: {obj.id}")
            self.objects[obj.id] = obj
        self.participants: dict[str, SessionParticipant] = {}
        self.revision = 0

    def connect(self, participant: SessionParticipant) -> bool:
        if participant.player_id in self.participants:
            return False
        self.participants[participant.player_id] = participant
        self.broadcast()
        return True

    def disconnect(self, participant: SessionParticipant):
        if self.participants.get(participant.player_id) is participant:
            del self.participants[participant.player_id]
            self.broadcast()

    def connection_overview(self) -> list[AdminConnectionRead]:
        return [
            AdminConnectionRead(
                player_id=participant.player_id,
                display_name=participant.display_name,
                connected_at=participant.connected_at,
                ping_ms=round(participant.ping_ms, 1) if participant.ping_ms is not None else None,
                fps=(
                    round(participant.fps, 1)
                    if participant.fps is not None
                    and participant.fps_updated_at is not None
                    and monotonic() - participant.fps_updated_at <= 10
                    else None
                ),
            )
            for participant in self.participants.values()
        ]

    async def heartbeat(self, participant: SessionParticipant, interval: float = 5) -> None:
        while self.participants.get(participant.player_id) is participant:
            nonce = str(uuid4())
            participant.pending_ping_nonce = nonce
            participant.pending_ping_started_at = monotonic()
            await participant.send_event(ServerEvent(name="ping", payload={"nonce": nonce}))
            await asyncio.sleep(interval)

    def record_fps(self, participant: SessionParticipant, report: ClientFpsReport) -> bool:
        now = monotonic()
        if now - participant.last_fps_report_at < 1:
            return False
        participant.last_fps_report_at = now
        participant.fps = report.value
        participant.fps_updated_at = now
        return True

    def record_pong(self, participant: SessionParticipant, pong: ClientPong) -> bool:
        if (pong.nonce != participant.pending_ping_nonce
                or participant.pending_ping_started_at is None):
            return False
        participant.ping_ms = max(0.0, (monotonic() - participant.pending_ping_started_at) * 1000)
        participant.pending_ping_nonce = None
        participant.pending_ping_started_at = None
        return True

    def handle_command(self, participant: SessionParticipant, command: Command) -> None:
        if isinstance(command, MoveCommand):
            self.move(participant, command)
            return
        if isinstance(command, InteractCommand):
            self.interact(participant, command)
            return
        raise ValueError(f"Unsupported command type: {command.type}")

    def move(self, participant: SessionParticipant, message: MoveCommand):
        now = monotonic()
        if now - participant.last_move < 0.05:
            return
        participant.last_move = now
        participant.position = message.position.model_dump()
        participant.rotation_y = message.rotation_y
        self.broadcast()

    def interact(self, participant: SessionParticipant, command: InteractCommand) -> None:
        obj = self.objects.get(command.object_id)
        if obj is None:
            raise ObjectNotFoundError(command.object_id)
        participant.last_interaction_object_id = obj.id
        self.set_object_state(obj.id, obj.interact().state)

    def set_object_state(self, object_id: str, state: ObjectState) -> WorldObject:
        obj = self.objects.get(object_id)
        if obj is None:
            raise ObjectNotFoundError(object_id)
        if obj.state != state:
            self.objects[object_id] = WorldObject(id=obj.id, state=state)
            self.broadcast()
        return self.objects[object_id]

    async def send_event(self, player_id: str, event: ServerEvent) -> bool:
        """Return whether an event was sent to a connected player."""
        participant = self.participants.get(player_id)
        if participant is None:
            return False
        return await participant.send_event(event)

    async def broadcast_event(self, event: ServerEvent) -> None:
        await asyncio.gather(*(
            participant.send_event(event)
            for participant in list(self.participants.values())
        ))

    def broadcast(self):
        self.revision += 1
        snapshot = {
            "type": "state",
            "revision": self.revision,
            "objects": [
                WorldObjectRead.model_validate(obj).model_dump(mode="json")
                for obj in self.objects.values()
            ],
            "players": [
                {"id": participant.player_id, "display_name": participant.display_name,
                 "position": participant.position, "rotation_y": participant.rotation_y,
                 "last_interaction_object_id": participant.last_interaction_object_id}
                for participant in self.participants.values()
            ],
        }
        for participant in self.participants.values():
            # Полный снимок заменяет устаревший: медленный клиент не тормозит мир.
            if participant.snapshots.full():
                participant.snapshots.get_nowait()
            participant.snapshots.put_nowait(snapshot)
