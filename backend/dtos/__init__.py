"""Request, response and WebSocket data transfer objects."""

from backend.dtos.admin_connections import AdminConnectionRead
from backend.dtos.event import ServerEvent
from backend.dtos.heartbeat import ClientFpsReport, ClientPong
from backend.dtos.world_object import WorldObjectRead
from backend.dtos.player import PlayerCreate, PlayerRead
from backend.dtos.stats import StatsRead
from backend.dtos.scenario import ScenarioRead
from backend.dtos.chat import ChatRequest, ChatResponse
from backend.dtos.speech import TranscriptionResponse
from backend.dtos.realtime import Position

__all__ = [
    "ServerEvent",
    "ClientPong",
    "ClientFpsReport",
    "AdminConnectionRead",
    "WorldObjectRead",
    "PlayerCreate",
    "PlayerRead",
    "StatsRead",
    "ScenarioRead",
    "ChatRequest",
    "ChatResponse",
    "TranscriptionResponse",
    "Position",
]
