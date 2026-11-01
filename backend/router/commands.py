from pydantic import TypeAdapter

from backend.dtos import ClientFpsReport, ClientPong

from backend.dtos.commands import Command, UserCommand

_command_adapter = TypeAdapter(UserCommand)
_pong_adapter = TypeAdapter(ClientPong)
_fps_adapter = TypeAdapter(ClientFpsReport)


def parse_fps_report(raw: str) -> ClientFpsReport:
    """Validate a client render-rate report."""
    return _fps_adapter.validate_json(raw)


def parse_pong(raw: str) -> ClientPong:
    """Validate a WebSocket heartbeat response."""
    return _pong_adapter.validate_json(raw)


def parse_command(raw: str) -> Command:
    """Validate WebSocket JSON and select a supported command by type."""
    return _command_adapter.validate_json(raw)
