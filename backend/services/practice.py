import asyncio
import json
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
from backend.models.world_object import ObjectState
from backend.services.sessions import ObjectNotFoundError, SessionService


LIGHT_TOOLS = [{
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
}, {
    "type": "function",
    "function": {
        "name": "keep_light_state",
        "description": (
            "Оставить свет без изменений, если текущая реплика не просит изменить "
            "освещение: обычный разговор, вопрос, цитата, обсуждение или запрет действия."
        ),
        "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
    },
}]

LIGHT_INSTRUCTION = (
    "Ты выбираешь действие освещения для ТЕКУЩЕЙ последней реплики игрока. "
    "Не отвечай текстом, вызови ровно один инструмент. На каждую новую просьбу "
    "включить или выключить свет заново вызови set_light_state с нужным целевым "
    "состоянием, даже если в истории уже есть похожая просьба и подтверждение. "
    "Ясная косвенная просьба, например «здесь темно, ничего не видно», тоже требует "
    "set_light_state. История нужна только для понимания ссылок вроде «теперь наоборот»; "
    "старые подтверждения не выполняют новую просьбу и не доказывают текущее состояние. "
    "Если текущая реплика не просит менять свет, выбери keep_light_state. "
    "Обсуждение, цитата и запрет «не выключай свет» не являются просьбой выключить его."
)

LIGHT_REPLY_INSTRUCTION = (
    "Результат инструмента в этой реплике — фактический результат сервера. "
    "Подтверждай изменение света только при ok=true и requested=true. "
    "При changed=false свет уже был в указанном состоянии, не утверждай, что изменил его. "
    "При requested=false свет не меняли; продолжи разговор по текущей реплике. "
    "При ok=false сообщи, что действие не удалось. Не опирайся на старые подтверждения."
)


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
                reply, used = await self._dialogue_reply(role, history, knowledge, message)
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

    async def _dialogue_reply(self, role: str, history: list[tuple[str, str]],
                              knowledge: list[dict], message: str) -> tuple[str, list[dict]]:
        builder = ContextBuilder(self.ai)
        if self.game_session is None:
            messages, used = await builder.dialogue(role, history, knowledge, message)
            return await self.ai.generate(messages), used

        light = self.game_session.objects.get("office-light")
        live_state = light.state.value if light else "unavailable"
        selection_role = LIGHT_INSTRUCTION + f"\nТекущее состояние света по данным сервера: {live_state}."
        # Выбор действия отделён от роли NPC и базы знаний. История остаётся
        # доступна для коротких связанных просьб; решение требуется на каждый ход.
        messages, _ = await builder.dialogue(selection_role, history, [], message,
            tools=LIGHT_TOOLS, tool_choice="required")
        assistant_message = await self.ai.chat_completion(messages, tools=LIGHT_TOOLS,
            tool_choice="required", temperature=0)
        calls = assistant_message.get("tool_calls")
        if not calls or len(calls) != 1:
            raise HTTPException(502, "Qwen должен выбрать ровно одно действие освещения")
        call = calls[0]
        tool_result = self._apply_light_call(call)

        continuation = [
            {"role": "assistant", "content": None, "tool_calls": calls},
            {"role": "tool", "tool_call_id": call["id"], "content": json.dumps(tool_result)},
        ]
        # Схема инструмента и ответ tool меняют размер prompt. Второй запрос также
        # проходит токенизацию; сокращаем только прежнюю историю и справку.
        followup, used = await builder.dialogue(role + "\n\n" + LIGHT_REPLY_INSTRUCTION,
            history, knowledge, message,
            continuation=continuation)
        return await self.ai.generate(followup), used

    def _apply_light_call(self, call: dict) -> dict:
        function = call["function"]
        keep = function["name"] == "keep_light_state"
        state = self._light_state_from_tool_call(call)
        if keep:
            try:
                if json.loads(function["arguments"]) != {}:
                    raise ValueError("Expected empty arguments")
            except (json.JSONDecodeError, TypeError, ValueError) as exc:
                raise HTTPException(502, "Некорректные аргументы keep_light_state") from exc
        elif state is None:
            raise HTTPException(502, "Некорректный вызов инструмента освещения")
        light = self.game_session.objects.get("office-light")
        if light is None:
            return {"ok": False, "requested": not keep, "changed": False,
                    "error": "The office light is unavailable"}
        if keep:
            return {"ok": True, "requested": False, "changed": False, "state": light.state.value}
        try:
            obj = self.game_session.set_object_state("office-light", state)
            return {"ok": True, "requested": True, "changed": light.state != obj.state,
                    "object_id": obj.id, "state": obj.state.value}
        except ObjectNotFoundError:
            return {"ok": False, "requested": True, "changed": False,
                    "error": "The office light is unavailable"}

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
