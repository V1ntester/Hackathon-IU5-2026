from uuid import UUID

from fastapi import APIRouter

from backend.dtos import PlayerCreate, PlayerRead, StatsRead
from backend.router.dependencies import Session
from backend.services.players import PlayerService

router = APIRouter(tags=["players"])


@router.post("/api/players", response_model=PlayerRead, status_code=201)
async def create_player(body: PlayerCreate, session: Session):
    return await PlayerService(session).create(body.display_name)


@router.get("/api/players/{player_id}/stats", response_model=StatsRead)
async def player_stats(player_id: UUID, session: Session):
    return await PlayerService(session).stats(str(player_id))
