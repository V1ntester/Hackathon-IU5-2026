from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import ScenarioKnowledge, QuestionKnowledge


class KnowledgeService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def search(self, scenario_id: str, message: str) -> list[dict]:
        # plainto_tsquery объединяет значимые слова алиаса через AND.
        rows = (await self.session.execute(text("""
            WITH query AS (
                SELECT to_tsvector('russian', replace(lower(:message), 'ё', 'е')) AS words,
                       plainto_tsquery('russian', replace(lower(:message), 'ё', 'е')) AS tsq
            ), candidates AS (
                SELECT k.*, (
                    SELECT count(*) FROM unnest(k.keywords) AS a(alias)
                    WHERE length(trim(a.alias)) > 0
                    AND numnode(plainto_tsquery('russian', replace(lower(a.alias), 'ё', 'е'))) > 0
                    AND q.words @@ plainto_tsquery('russian', replace(lower(a.alias), 'ё', 'е'))
                ) AS alias_count,
                to_tsvector('russian', replace(lower(k.context), 'ё', 'е')) @@ q.tsq AS full_match
                FROM scenario_knowledge k CROSS JOIN query q
                WHERE k.scenario_id = :scenario_id AND k.enabled = true
            ) SELECT id, version, context, priority FROM candidates
              WHERE alias_count > 0 OR full_match
              ORDER BY priority DESC, alias_count DESC, id ASC LIMIT 2
        """), {"scenario_id": scenario_id, "message": message})).mappings().all()
        return [dict(row) for row in rows]

    async def linked(self, question_id: str, scenario_id: str) -> list[dict]:
        rows = (await self.session.scalars(select(ScenarioKnowledge)
            .join(QuestionKnowledge, QuestionKnowledge.knowledge_id == ScenarioKnowledge.id)
            .where(QuestionKnowledge.question_id == question_id,
                   ScenarioKnowledge.scenario_id == scenario_id, ScenarioKnowledge.enabled.is_(True))
            .order_by(ScenarioKnowledge.priority.desc(), ScenarioKnowledge.id))).all()
        return [dict(id=k.id, version=k.version, context=k.context, priority=k.priority) for k in rows]
