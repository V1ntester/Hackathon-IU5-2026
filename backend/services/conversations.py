from datetime import timedelta
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import Conversation, DialogueTurn, User
from backend.models.base import utc_now
from backend.services.players import PlayerService
from backend.services.scenarios import ScenarioService


class ConversationService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def require(self, conversation_id: str, player_id: str, scenario_id: str, lock: bool = False) -> Conversation:
        await PlayerService(self.session).require(player_id)
        await ScenarioService(self.session).require(scenario_id)
        query = select(Conversation).where(Conversation.id == conversation_id)
        if lock:
            query = query.with_for_update()
        row = await self.session.scalar(query)
        if row is None:
            raise HTTPException(404, "Разговор не найден")
        if row.player_id != player_id or row.scenario_id != scenario_id:
            raise HTTPException(409, "Разговор не соответствует игроку или сценарию")
        return row

    async def create(self, player_id: str, scenario_id: str, request_id: str) -> str:
        await PlayerService(self.session).require(player_id)
        await ScenarioService(self.session).require(scenario_id)
        await self.session.execute(select(User.id).where(User.id == player_id).with_for_update())
        existing = await self.session.scalar(select(Conversation).where(
            Conversation.player_id == player_id, Conversation.request_id == request_id))
        if existing:
            if existing.scenario_id != scenario_id:
                raise HTTPException(409, "request_id уже использован для другого сценария")
            result = existing.id
        else:
            row = Conversation(player_id=player_id, scenario_id=scenario_id, request_id=request_id)
            self.session.add(row)
            await self.session.flush()
            result = row.id
        await self.session.commit()
        return result

    async def expire(self, conversation_id: str) -> None:
        await self.session.execute(update(DialogueTurn).where(
            DialogueTurn.conversation_id == conversation_id, DialogueTurn.status == "pending",
            DialogueTurn.expires_at <= utc_now()).values(status="failed", completed_at=utc_now()))

    async def reserve(self, conversation_id: str, player_id: str, scenario_id: str, request_id: str, message: str) -> dict:
        await self.require(conversation_id, player_id, scenario_id, lock=True)
        await self.expire(conversation_id)
        old = await self.session.scalar(select(DialogueTurn).where(
            DialogueTurn.conversation_id == conversation_id, DialogueTurn.request_id == request_id))
        if old and old.message != message:
            raise HTTPException(409, "Другой текст под тем же request_id")
        if old and old.status == "completed":
            result = {"reply": old.reply}
            await self.session.commit()
            return result
        pending = await self.session.scalar(select(DialogueTurn.id).where(
            DialogueTurn.conversation_id == conversation_id, DialogueTurn.status == "pending"))
        if pending:
            raise HTTPException(409, "Предыдущая реплика ещё обрабатывается; повторите тот же запрос позже")
        last = await self.session.scalar(select(func.coalesce(func.max(DialogueTurn.sequence), 0))
            .where(DialogueTurn.conversation_id == conversation_id))
        if old and old.sequence != last:
            raise HTTPException(409, "После этой реплики уже был другой обмен; начните новую отправку")
        row = old or DialogueTurn(conversation_id=conversation_id, request_id=request_id, sequence=last + 1, message=message)
        row.status = "pending"
        row.generation_id = str(uuid4())
        row.expires_at = utc_now() + timedelta(seconds=300)
        row.completed_at = None
        self.session.add(row)
        await self.session.flush()
        result = {"id": row.id, "generation_id": row.generation_id, "expires_at": row.expires_at}
        await self.session.commit()
        return result

    async def history(self, conversation_id: str) -> list[tuple[str, str]]:
        # Не загружаем всю БД в prompt; полная история доступна пагинацией.
        rows = (await self.session.execute(select(DialogueTurn.message, DialogueTurn.reply)
            .where(DialogueTurn.conversation_id == conversation_id, DialogueTurn.status == "completed")
            .order_by(DialogueTurn.sequence.desc()).limit(50))).all()
        return [(r.message, r.reply) for r in reversed(rows)]

    async def turns(self, conversation_id: str, player_id: str, scenario_id: str, after: int, limit: int) -> list[dict]:
        await self.require(conversation_id, player_id, scenario_id, lock=True)
        await self.expire(conversation_id)
        rows = (await self.session.scalars(select(DialogueTurn).where(
            DialogueTurn.conversation_id == conversation_id, DialogueTurn.sequence > after)
            .order_by(DialogueTurn.sequence).limit(limit))).all()
        result = [dict(sequence=r.sequence, request_id=r.request_id, message=r.message, reply=r.reply, status=r.status) for r in rows]
        await self.session.commit()
        return result
