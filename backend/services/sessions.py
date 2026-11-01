import asyncio
from dataclasses import dataclass, field
from time import monotonic

from fastapi import WebSocket
from starlette.websockets import WebSocketDisconnect

from backend.dtos import ServerEvent
from backend.dtos.commands import Command, InteractCommand, MoveCommand


@dataclass
class SessionParticipant:
    websocket: WebSocket
    player_id: str
    display_name: str
    position: dict = field(default_factory=lambda: {"x": 0.0, "y": 0.0, "z": 0.0})
    rotation_y: float = 0.0
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

    def __init__(self):
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
        participant.last_interaction_object_id = command.object_id
        self.broadcast()

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
