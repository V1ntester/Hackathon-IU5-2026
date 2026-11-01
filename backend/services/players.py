from fastapi import HTTPException
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import PlayerStats, User


class PlayerService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def find(self, player_id: str) -> User | None:
        return await self.session.get(User, player_id)

    async def require(self, player_id: str) -> User:
        player = await self.find(player_id)
        if player is None:
            raise HTTPException(404, "Игрок не найден")
        return player

    async def create(self, display_name: str) -> User:
        player = User(display_name=display_name)
        self.session.add(player)
        await self.session.flush()
        self.session.add(PlayerStats(user_id=player.id))
        await self.session.commit()
        return player

    async def stats(self, player_id: str) -> PlayerStats | None:
        await self.require(player_id)
        return await self.session.get(PlayerStats, player_id)

    async def record_connection(self, player_id: str) -> None:
        await self._increment(player_id, PlayerStats.connections)

    async def record_text_request(self, player_id: str) -> None:
        await self._increment(player_id, PlayerStats.text_requests)

    async def record_voice_request(self, player_id: str) -> None:
        await self._increment(player_id, PlayerStats.voice_requests)

    async def _increment(self, player_id: str, counter) -> None:
        await self.session.execute(
            update(PlayerStats).where(PlayerStats.user_id == player_id)
            .values({counter: counter + 1})
        )
        await self.session.commit()
