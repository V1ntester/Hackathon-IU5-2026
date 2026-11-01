from pydantic import TypeAdapter

from backend.dtos.commands import Command, UserCommand

_command_adapter = TypeAdapter(UserCommand)


def parse_command(raw: str) -> Command:
    """Validate WebSocket JSON and select a supported command by type."""
    return _command_adapter.validate_json(raw)
