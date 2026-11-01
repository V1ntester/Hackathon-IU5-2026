from fastapi import HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from backend.services.ai_inference import AIInferenceService, AUDIO_FORMATS
from backend.config import Settings
from backend.services.players import PlayerService
from backend.services.scenarios import ScenarioService


class PracticeService:
    def __init__(self, session: AsyncSession, ai: AIInferenceService, settings: Settings):
        self.session = session
        self.ai = ai
        self.settings = settings
        self.players = PlayerService(session)
        self.scenarios = ScenarioService(session)

    async def chat(self, player_id: str, scenario_id: str, message: str) -> str:
        await self.players.require(player_id)
        scenario = await self.scenarios.require(scenario_id)
        prompt = scenario.system_prompt
        # Не держим транзакцию БД во время долгой генерации.
        await self.session.rollback()
        reply = await self.ai.chat(prompt, message)
        await self.players.record_text_request(player_id)
        return reply

    async def transcribe(self, player_id: str, file: UploadFile) -> str:
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
            text = await self.ai.transcribe(audio, content_type)
            await self.players.record_voice_request(player_id)
            return text
        finally:
            await file.close()
