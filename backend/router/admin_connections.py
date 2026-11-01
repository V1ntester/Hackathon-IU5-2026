from fastapi import APIRouter, Request

from backend.dtos.admin_connections import AdminConnectionRead
from backend.services.sessions import SessionService

router = APIRouter(prefix="/api/admin/connections", tags=["admin connections"])


@router.get("", response_model=list[AdminConnectionRead])
async def list_connections(request: Request):
    game_session: SessionService = request.app.state.game_session
    return game_session.connection_overview()
