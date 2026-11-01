import asyncio
from dataclasses import dataclass, field
from time import monotonic

from fastapi import WebSocket
from starlette.websockets import WebSocketDisconnect

from backend.dtos import MoveMessage


@dataclass
class SessionParticipant:
    websocket: WebSocket
    player_id: str
    display_name: str
    position: dict = field(default_factory=lambda: {"x": 0.0, "y": 0.0, "z": 0.0})
    rotation_y: float = 0.0
    last_move: float = float("-inf")
    snapshots: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=1))

    async def send_snapshots(self):
        try:
            while True:
                snapshot = await self.snapshots.get()
                await asyncio.wait_for(self.websocket.send_json(snapshot), timeout=5)
        except (OSError, RuntimeError, asyncio.TimeoutError, WebSocketDisconnect):
            # Закрытие будит receive в обработчике, который удаляет игрока.
            try:
                await self.websocket.close(code=1011)
            except (OSError, RuntimeError, WebSocketDisconnect):
                pass


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

    def move(self, participant: SessionParticipant, message: MoveMessage):
        now = monotonic()
        if now - participant.last_move < 0.05:
            return
        participant.last_move = now
        participant.position = message.position.model_dump()
        participant.rotation_y = message.rotation_y
        self.broadcast()

    def broadcast(self):
        self.revision += 1
        snapshot = {
            "type": "state",
            "revision": self.revision,
            "players": [
                {"id": participant.player_id, "display_name": participant.display_name,
                 "position": participant.position, "rotation_y": participant.rotation_y}
                for participant in self.participants.values()
            ],
        }
        for participant in self.participants.values():
            # Полный снимок заменяет устаревший: медленный клиент не тормозит мир.
            if participant.snapshots.full():
                participant.snapshots.get_nowait()
            participant.snapshots.put_nowait(snapshot)
