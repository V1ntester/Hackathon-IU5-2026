import asyncio
import logging
import re
from datetime import timedelta
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import session_factory
from backend.dtos.interviews import EvaluationResult
from backend.models import DialogueTurn, InterviewAttempt, InterviewItem, PlayerStats
from backend.models.base import utc_now
from backend.services.ai_inference import AIInferenceService
from backend.services.context_builder import ContextBuilder, EVALUATOR_VERSION
from backend.services.interviews import InterviewService

logger = logging.getLogger(__name__)


def build_report(items: list[InterviewItem]) -> str:
    sections, recommendations, total = [], [], 0
    for item in items:
        grade = EvaluationResult.model_validate(item.evaluation)
        total += grade.relevance + grade.correctness + grade.completeness
        sections.append(f"Вопрос №{item.position}\n{item.snapshot['text']}\nВаш ответ: {item.answer}\n"
            f"Соответствие: {grade.relevance}/2\nКорректность: {grade.correctness}/2\nПолнота: {grade.completeness}/2\n"
            f"Что получилось: {grade.strength}\nЧто улучшить: {grade.issue}\nРекомендация: {grade.recommendation}")
        if grade.recommendation:
            recommendations.append(f"{item.position}. {grade.recommendation}")
    return "\n\n".join(sections) + f"\n\nСумма: {total}/24\nПроцент: {round(100 * total / 24)}%\nРекомендации:\n" + "\n".join(recommendations)


class EvaluationService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def start(self, attempt_id: str, player_id: str, scenario_id: str, retry: bool) -> str | None:
        interviews = InterviewService(self.session)
        attempt = await interviews.require(attempt_id, player_id, scenario_id)
        if attempt.status in ("completed", "evaluating"):
            await self.session.commit()
            return None
        expected = "evaluation_failed" if retry else "ready_for_evaluation"
        if attempt.status != expected:
            await self.session.commit()
            raise HTTPException(409, "Для повтора используйте retry-evaluation; сначала нужны четыре ответа")
        items = await interviews.items(attempt_id)
        if len(items) != 4 or any(i.answer is None for i in items):
            raise HTTPException(409, "Сначала подтвердите четыре ответа")
        run_id = str(uuid4())
        attempt.status, attempt.evaluation_id = "evaluating", run_id
        # Страховка потери исполнителя: обновляется перед каждой позицией.
        attempt.evaluation_expires_at = utc_now() + timedelta(seconds=330)
        await self.session.commit()
        return run_id

    async def run(self, attempt_id: str, run_id: str, ai: AIInferenceService) -> None:
        for position in range(1, 5):
            attempt = await self.session.scalar(select(InterviewAttempt).where(InterviewAttempt.id == attempt_id).with_for_update().execution_options(populate_existing=True))
            if attempt.status != "evaluating" or attempt.evaluation_id != run_id:
                await self.session.rollback()
                return
            item = await self.session.scalar(select(InterviewItem).where(
                InterviewItem.attempt_id == attempt_id, InterviewItem.position == position))
            if item.evaluation_status == "completed":
                await self.session.commit()
                continue
            item.evaluation_status = "evaluating"
            item.generation_id = str(uuid4())
            item.expires_at = utc_now() + timedelta(seconds=300)
            attempt.evaluation_expires_at = utc_now() + timedelta(seconds=330)
            item.evaluator_version, item.error = EVALUATOR_VERSION, None
            item_id, token, expiry = item.id, item.generation_id, item.expires_at
            snapshot, answer, player_id = item.snapshot, item.answer, attempt.player_id
            await self.session.commit()
            conditions = (InterviewItem.id == item_id, InterviewItem.generation_id == token,
                          InterviewItem.evaluation_status == "evaluating")
            try:
                async with asyncio.timeout(max(0, (expiry - utc_now()).total_seconds())):
                    messages = await ContextBuilder(ai).evaluation(snapshot, answer)
                    raw = await ai.generate(messages, reserve=384, temperature=0)
                    # Снимаем только целый внешний Markdown-блок, содержимое не исправляем.
                    fenced = re.fullmatch(r"```(?:json)?\s*\n(.*?)\n```", raw.strip(), flags=re.DOTALL)
                    if fenced:
                        raw = fenced.group(1)
                    grade = EvaluationResult.model_validate_json(raw)
                    # Тот же порядок блокировок, что у HTTP и восстановления: parent → item.
                    current = await self.session.scalar(select(InterviewAttempt).where(InterviewAttempt.id == attempt_id).with_for_update().execution_options(populate_existing=True))
                    if current.status != "evaluating" or current.evaluation_id != run_id:
                        await self.session.rollback()
                        return
                    saved = await self.session.execute(update(InterviewItem).where(*conditions,
                        InterviewItem.expires_at > utc_now()).values(evaluation_status="completed", evaluation=grade.model_dump()))
                    if saved.rowcount != 1:
                        raise HTTPException(409, "Попытка оценивания устарела")
                    await self.session.execute(update(PlayerStats).where(PlayerStats.user_id == player_id)
                        .values(text_requests=PlayerStats.text_requests + 1))
                    await self.session.commit()
            except Exception:
                await self.session.rollback()
                await self.session.execute(update(InterviewItem).where(*conditions)
                    .values(evaluation_status="failed", error="Не удалось получить валидную оценку; доступен повтор"))
                await self.session.commit()
        attempt = await self.session.scalar(select(InterviewAttempt).where(InterviewAttempt.id == attempt_id).with_for_update().execution_options(populate_existing=True))
        if attempt.status != "evaluating" or attempt.evaluation_id != run_id:
            await self.session.rollback()
            return
        items = await InterviewService(self.session).items(attempt_id)
        if all(i.evaluation_status == "completed" for i in items):
            attempt.report_text = build_report(items)
            attempt.completed_at, attempt.status = utc_now(), "completed"
        else:
            attempt.status = "evaluation_failed"
        attempt.evaluation_id = None
        await self.session.commit()


async def evaluate_attempt(attempt_id: str, run_id: str, ai: AIInferenceService) -> None:
    # Никогда не используем сессию HTTP-обработчика в фоновой задаче.
    async with session_factory() as session:
        try:
            await EvaluationService(session).run(attempt_id, run_id, ai)
        except Exception:
            logger.exception("Interview evaluation task failed: %s", attempt_id)
            await session.rollback()
            attempt = await session.scalar(select(InterviewAttempt).where(InterviewAttempt.id == attempt_id).with_for_update().execution_options(populate_existing=True))
            if attempt and attempt.evaluation_id == run_id:
                await session.execute(update(InterviewItem).where(InterviewItem.attempt_id == attempt_id,
                    InterviewItem.evaluation_status != "completed").values(evaluation_status="failed", error="Задача прервана"))
                attempt.status, attempt.evaluation_id = "evaluation_failed", None
                await session.commit()


async def recover_interrupted() -> None:
    # Проект запускается одним процессом. При старте старых исполнителей уже нет.
    async with session_factory() as session:
        await session.execute(update(DialogueTurn).where(DialogueTurn.status == "pending")
            .values(status="failed", completed_at=utc_now()))
        attempts = select(InterviewAttempt.id).where(InterviewAttempt.status == "evaluating")
        await session.execute(update(InterviewItem).where(InterviewItem.attempt_id.in_(attempts),
            InterviewItem.evaluation_status != "completed").values(evaluation_status="failed", error="Приложение перезапущено"))
        await session.execute(update(InterviewAttempt).where(InterviewAttempt.status == "evaluating")
            .values(status="evaluation_failed", evaluation_id=None))
        await session.commit()


async def reap_expired() -> None:
    while True:
        await asyncio.sleep(30)
        try:
            async with session_factory() as session:
                await session.execute(update(DialogueTurn).where(DialogueTurn.status == "pending",
                    DialogueTurn.expires_at <= utc_now()).values(status="failed", completed_at=utc_now()))
                attempts = (await session.scalars(select(InterviewAttempt).where(
                    InterviewAttempt.status == "evaluating").with_for_update(skip_locked=True))).all()
                for attempt in attempts:
                    await InterviewService(session).expire(attempt)
                await session.commit()
        except Exception:
            logger.exception("Failed to recover expired practice operations")

