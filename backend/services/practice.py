import asyncio
from uuid import uuid4

from fastapi import HTTPException, UploadFile
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.services.ai_inference import AIInferenceService, AUDIO_FORMATS
from backend.config import Settings
from backend.services.players import PlayerService
from backend.services.scenarios import ScenarioService
from backend.models import DialogueTurn, PlayerStats
from backend.models.base import utc_now
from backend.services.conversations import ConversationService
from backend.services.context_builder import ContextBuilder
from backend.services.knowledge import KnowledgeService


class PracticeService:
    def __init__(self, session: AsyncSession, ai: AIInferenceService, settings: Settings):
        self.session = session
        self.ai = ai
        self.settings = settings
        self.players = PlayerService(session)
        self.scenarios = ScenarioService(session)

    async def chat(self, player_id: str, scenario_id: str, message: str,
                   conversation_id: str | None = None, request_id: str | None = None) -> str:
        conversations = ConversationService(self.session)
        if conversation_id is None:
            conversation_id = await conversations.create(player_id, scenario_id, str(uuid4()))
            request_id = str(uuid4())
        reservation = await conversations.reserve(conversation_id, player_id, scenario_id, request_id, message)
        if "reply" in reservation:
            return reservation["reply"]
        conditions = (DialogueTurn.id == reservation["id"],
                      DialogueTurn.generation_id == reservation["generation_id"], DialogueTurn.status == "pending")
        try:
            remaining = (reservation["expires_at"] - utc_now()).total_seconds()
            async with asyncio.timeout(max(0, remaining)):
                role = (await self.scenarios.require(scenario_id)).system_prompt
                history = await conversations.history(conversation_id)
                knowledge = await KnowledgeService(self.session).search(scenario_id, message)
                await self.session.commit()
                messages, used = await ContextBuilder(self.ai).dialogue(role, history, knowledge, message)
                reply = await self.ai.generate(messages)
                saved = await self.session.execute(update(DialogueTurn).where(*conditions,
                    DialogueTurn.expires_at > utc_now()).values(reply=reply, status="completed",
                    completed_at=utc_now(), knowledge_used=used))
                if saved.rowcount != 1:
                    raise HTTPException(409, "Попытка генерации устарела; восстановите историю")
                await self.session.execute(update(PlayerStats).where(PlayerStats.user_id == player_id)
                    .values(text_requests=PlayerStats.text_requests + 1))
                await self.session.commit()
                return reply
        except BaseException as exc:
            await self.session.rollback()
            await self.session.execute(update(DialogueTurn).where(*conditions)
                .values(status="failed", completed_at=utc_now()))
            await self.session.commit()
            if isinstance(exc, TimeoutError):
                raise HTTPException(504, "Превышен общий срок генерации 300 секунд") from exc
            raise

    async def transcribe(self, player_id: str, file: UploadFile, language: str = "auto") -> str:
        try:
            await self.players.require(player_id)
            await self.session.rollback()
            # Читаем не более лимита + 1 байт, постоянную копию аудио не создаём.
            audio = await file.read(self.settings.max_audio_bytes + 1)
            if len(audio) > self.settings.max_audio_bytes:
                raise HTTPException(413, "Аудиофайл превышает допустимый размер")
            if not audio:
                raise HTTPException(422, "Аудиофайл пуст")
            content_type = (file.content_type or "").split(";", 1)[0].strip().lower()
            if content_type not in AUDIO_FORMATS:
                raise HTTPException(415, "Неподдерживаемый формат аудио")
            if AUDIO_FORMATS[content_type] == "wav" and (
                len(audio) < 12 or audio[:4] != b"RIFF" or audio[8:12] != b"WAVE"
            ):
                raise HTTPException(415, "Некорректный заголовок WAV")
            text = await self.ai.transcribe(audio, content_type, language)
            await self.players.record_voice_request(player_id)
            return text
        finally:
            await file.close()
