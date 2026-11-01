import json

from fastapi import HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from backend.services.ai_inference import AIInferenceService, AUDIO_FORMATS
from backend.config import Settings
from backend.services.players import PlayerService
from backend.services.scenarios import ScenarioService
from backend.models.world_object import ObjectState
from backend.services.sessions import ObjectNotFoundError, SessionService


LIGHT_TOOL = [{
    "type": "function",
    "function": {
        "name": "set_light_state",
        "description": (
            "Установить общее освещение лобби в нужное состояние. Вызывай при прямой "
            "просьбе включить или выключить свет и при ясном косвенном запросе "
            "(например: «здесь слишком темно, ничего не видно»). Не вызывай при "
            "простом обсуждении света без просьбы изменить его."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "state": {
                    "type": "string",
                    "enum": [ObjectState.ACTIVE.value, ObjectState.INACTIVE.value],
                    "description": "active — свет включён; inactive — свет выключен",
                },
            },
            "required": ["state"],
            "additionalProperties": False,
        },
    },
}]


class PracticeService:
    def __init__(
        self,
        session: AsyncSession,
        ai: AIInferenceService,
        settings: Settings,
        game_session: SessionService | None = None,
    ):
        self.session = session
        self.ai = ai
        self.settings = settings
        self.game_session = game_session
        self.players = PlayerService(session)
        self.scenarios = ScenarioService(session)

    async def chat(self, player_id: str, scenario_id: str, message: str) -> str:
        await self.players.require(player_id)
        scenario = await self.scenarios.require(scenario_id)
        prompt = scenario.system_prompt
        # Не держим транзакцию БД во время долгой генерации.
        await self.session.rollback()
        if self.game_session is None:
            reply = await self.ai.chat(prompt, message)
        else:
            system_prompt = (
                f"{prompt}\n\n"
                "Игрок может управлять общим освещением лобби. Выполняй прямую просьбу "
                "включить или выключить свет, а также однозначную косвенную просьбу "
                "(например, если игрок говорит, что темно и ничего не видно). Одно лишь "
                "упоминание света без просьбы не меняет его. После изменения коротко "
                "подтверди результат в ответе."
            )
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": message},
            ]
            assistant_message = await self.ai.chat_completion(messages, tools=LIGHT_TOOL)
            tool_calls = assistant_message.get("tool_calls")
            if not isinstance(tool_calls, list) or not tool_calls:
                reply = assistant_message.get("content")
            elif len(tool_calls) != 1 or not isinstance(tool_calls[0], dict):
                reply = assistant_message.get("content")
            else:
                call = tool_calls[0]
                state = self._light_state_from_tool_call(call)
                if state is None:
                    tool_result = {"ok": False, "error": "Unsupported light state"}
                else:
                    try:
                        obj = self.game_session.set_object_state("office-light", state)
                        tool_result = {"ok": True, "object_id": obj.id, "state": obj.state.value}
                    except ObjectNotFoundError:
                        tool_result = {"ok": False, "error": "The office light is unavailable"}

                messages.append({
                    "role": "assistant",
                    "content": assistant_message.get("content"),
                    "tool_calls": tool_calls,
                })
                messages.append({
                    "role": "tool",
                    "tool_call_id": call.get("id") or "light-state",
                    "content": json.dumps(tool_result),
                })
                final_message = await self.ai.chat_completion(messages)
                reply = final_message.get("content")

        if not isinstance(reply, str) or not reply.strip():
            raise HTTPException(502, "Qwen вернул ответ без текста")
        await self.players.record_text_request(player_id)
        return reply.strip()

    @staticmethod
    def _light_state_from_tool_call(call: object) -> ObjectState | None:
        if not isinstance(call, dict) or call.get("type") != "function":
            return None
        function = call.get("function")
        if not isinstance(function, dict) or function.get("name") != "set_light_state":
            return None
        try:
            arguments = json.loads(function.get("arguments", ""))
            if not isinstance(arguments, dict) or set(arguments) != {"state"}:
                return None
            return ObjectState(arguments["state"])
        except (json.JSONDecodeError, TypeError, ValueError):
            return None

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
