import asyncio
import random

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.dtos.interviews import InterviewState, CurrentQuestion
from backend.models import InterviewAttempt, InterviewItem, InterviewQuestion, User
from backend.models.base import utc_now
from backend.services.ai_inference import AIInferenceService
from backend.services.context_builder import ContextBuilder
from backend.services.knowledge import KnowledgeService
from backend.services.interview_settings import InterviewSettingsService
from backend.services.players import PlayerService
from backend.services.scenarios import ScenarioService


class InterviewService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def identity(self, player_id: str, scenario_id: str) -> None:
        await PlayerService(self.session).require(player_id)
        await ScenarioService(self.session).require(scenario_id)

    async def require(self, attempt_id: str, player_id: str, scenario_id: str) -> InterviewAttempt:
        await self.identity(player_id, scenario_id)
        attempt = await self.session.scalar(select(InterviewAttempt).where(InterviewAttempt.id == attempt_id).with_for_update())
        if attempt is None:
            raise HTTPException(404, "Интервью не найдено")
        if attempt.player_id != player_id or attempt.scenario_id != scenario_id:
            raise HTTPException(409, "Интервью не соответствует игроку или сценарию")
        await self.expire(attempt)
        return attempt

    async def items(self, attempt_id: str) -> list[InterviewItem]:
        return list((await self.session.scalars(select(InterviewItem).where(InterviewItem.attempt_id == attempt_id)
            .order_by(InterviewItem.position))).all())

    async def expire(self, attempt: InterviewAttempt) -> None:
        if attempt.status != "evaluating":
            return
        now = utc_now()
        expired = await self.session.scalar(select(InterviewItem.id).where(
            InterviewItem.attempt_id == attempt.id, InterviewItem.evaluation_status == "evaluating",
            InterviewItem.expires_at <= now).limit(1))
        if expired:
            await self.session.execute(update(InterviewItem).where(InterviewItem.attempt_id == attempt.id,
                InterviewItem.evaluation_status == "evaluating", InterviewItem.expires_at <= now)
                .values(evaluation_status="failed", error="Срок оценивания позиции истёк"))
        if not attempt.evaluation_expires_at or attempt.evaluation_expires_at <= now:
            await self.session.execute(update(InterviewItem).where(InterviewItem.attempt_id == attempt.id,
                InterviewItem.evaluation_status != "completed").values(evaluation_status="failed", error="Срок операции истёк"))
            attempt.status = "evaluation_failed"
            attempt.evaluation_id = None

    async def create(self, player_id: str, scenario_id: str, request_id: str, ai: AIInferenceService) -> str:
        await self.identity(player_id, scenario_id)
        existing = await self.session.scalar(select(InterviewAttempt).where(
            InterviewAttempt.player_id == player_id, InterviewAttempt.request_id == request_id))
        if existing:
            if existing.scenario_id != scenario_id:
                raise HTTPException(409, "request_id уже использован для другого сценария")
            result = existing.id
            await self.session.commit()
            return result
        topic = await InterviewSettingsService(self.session).selected(scenario_id)
        query = select(InterviewQuestion).where(
            InterviewQuestion.scenario_id == scenario_id, InterviewQuestion.enabled.is_(True))
        if topic is not None:
            query = query.where(InterviewQuestion.topic == topic)
        questions = (await self.session.scalars(query)).all()
        snapshots = []
        for q in questions:
            if (not q.text.strip() or not q.reference_answer.strip()
                or not isinstance(q.required_points, list) or not q.required_points
                or not all(isinstance(p, str) and p.strip() for p in q.required_points)
                or not isinstance(q.common_errors, list)
                or not all(isinstance(p, str) for p in q.common_errors)):
                continue
            snapshots.append(dict(question_id=q.id, question_version=q.version, topic=q.topic, text=q.text,
                reference_answer=q.reference_answer, required_points=q.required_points, common_errors=q.common_errors,
                knowledge=await KnowledgeService(self.session).linked(q.id, scenario_id)))
        # Снимки уже в обычных структурах. Токенизация выполняется вне транзакции.
        await self.session.commit()
        pool_error = (f"В теме «{topic}» менее четырёх пригодных активных вопросов"
                      if topic else "В сценарии менее четырёх пригодных активных вопросов")
        if len(snapshots) < 4:
            raise HTTPException(409, pool_error)
        eligible = []
        try:
            async with asyncio.timeout(300):
                for snapshot in snapshots:
                    if await ContextBuilder(ai).admit_question(snapshot):
                        eligible.append(snapshot)
        except TimeoutError as exc:
            raise HTTPException(504, "Истёк срок проверки размера пула вопросов") from exc
        if len(eligible) < 4:
            raise HTTPException(409, pool_error)
        chosen = random.SystemRandom().sample(eligible, 4)
        # Сериализация создания и повторная проверка ключа после токенизации.
        await self.session.execute(select(User.id).where(User.id == player_id).with_for_update())
        existing = await self.session.scalar(select(InterviewAttempt).where(
            InterviewAttempt.player_id == player_id, InterviewAttempt.request_id == request_id))
        if existing:
            if existing.scenario_id != scenario_id:
                raise HTTPException(409, "request_id уже использован для другого сценария")
            result = existing.id
        else:
            attempt = InterviewAttempt(player_id=player_id, scenario_id=scenario_id, request_id=request_id, topic=topic)
            self.session.add(attempt)
            await self.session.flush()
            for position, snapshot in enumerate(chosen, 1):
                self.session.add(InterviewItem(attempt_id=attempt.id, position=position,
                    question_id=snapshot["question_id"], snapshot=snapshot))
            result = attempt.id
        await self.session.commit()
        return result

    async def state(self, attempt_id: str, player_id: str, scenario_id: str) -> InterviewState:
        attempt = await self.require(attempt_id, player_id, scenario_id)
        items = await self.items(attempt_id)
        current = next((i for i in items if i.answer is None), None)
        result = InterviewState(id=attempt.id, status=attempt.status, topic=attempt.topic,
            answered=sum(i.answer is not None for i in items),
            evaluated=sum(i.evaluation_status == "completed" for i in items),
            current_question=CurrentQuestion(position=current.position, text=current.snapshot["text"]) if current else None)
        await self.session.commit()
        return result

    async def answer(self, attempt_id: str, player_id: str, scenario_id: str, position: int, request_id: str, answer: str) -> InterviewState:
        attempt = await self.require(attempt_id, player_id, scenario_id)
        items = await self.items(attempt_id)
        old = next((i for i in items if i.answer_request_id == request_id), None)
        if old:
            if old.position != position or old.answer != answer:
                raise HTTPException(409, "Другой ответ или позиция под тем же request_id")
        else:
            current = next((i for i in items if i.answer is None), None)
            if attempt.status != "in_progress" or current is None or current.position != position:
                raise HTTPException(409, "Ответ уже подтверждён или вопрос не текущий")
            current.answer, current.answer_request_id = answer, request_id
            if all(i.answer is not None for i in items):
                attempt.status = "ready_for_evaluation"
        await self.session.commit()
        return await self.state(attempt_id, player_id, scenario_id)

    async def report(self, attempt_id: str, player_id: str, scenario_id: str) -> tuple[int, dict]:
        attempt = await self.require(attempt_id, player_id, scenario_id)
        if attempt.status == "completed":
            result = (200, dict(status=attempt.status, report_text=attempt.report_text))
        elif attempt.status == "evaluating":
            result = (202, dict(status=attempt.status))
        else:
            await self.session.commit()
            raise HTTPException(409, "Завершите интервью или повторите неуспешное оценивание")
        await self.session.commit()
        return result
