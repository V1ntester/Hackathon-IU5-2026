import asyncio
from dataclasses import dataclass, field
from time import monotonic

from fastapi import WebSocket
from starlette.websockets import WebSocketDisconnect

from backend.schemas import MoveMessage


@dataclass
class Peer:
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


class World:
    """Один мир на один процесс; методы без await атомарны в event loop."""

    def __init__(self):
        self.peers: dict[str, Peer] = {}
        self.revision = 0

    def connect(self, peer: Peer) -> bool:
        if peer.player_id in self.peers:
            return False
        self.peers[peer.player_id] = peer
        self.broadcast()
        return True

    def disconnect(self, peer: Peer):
        if self.peers.get(peer.player_id) is peer:
            del self.peers[peer.player_id]
            self.broadcast()

    def move(self, peer: Peer, message: MoveMessage):
        now = monotonic()
        if now - peer.last_move < 0.05:
            return
        peer.last_move = now
        peer.position = message.position.model_dump()
        peer.rotation_y = message.rotation_y
        self.broadcast()

    def broadcast(self):
        self.revision += 1
        snapshot = {
            "type": "state",
            "revision": self.revision,
            "players": [
                {"id": peer.player_id, "display_name": peer.display_name,
                 "position": peer.position, "rotation_y": peer.rotation_y}
                for peer in self.peers.values()
            ],
        }
        for peer in self.peers.values():
            # Полный снимок заменяет устаревший: медленный клиент не тормозит мир.
            if peer.snapshots.full():
                peer.snapshots.get_nowait()
            peer.snapshots.put_nowait(snapshot)
