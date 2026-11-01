"""История, знания, снимки интервью и начальный технический пул."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("conversations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("player_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("scenario_id", sa.String(50), sa.ForeignKey("scenarios.id"), nullable=False),
        sa.Column("request_id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("player_id", "request_id"))
    op.create_table("dialogue_turns",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("conversation_id", sa.String(36), sa.ForeignKey("conversations.id"), nullable=False),
        sa.Column("request_id", sa.String(36), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("message", sa.Text(), nullable=False), sa.Column("reply", sa.Text()),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("generation_id", sa.String(36)), sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("knowledge_used", pg.JSONB(), nullable=False),
        sa.UniqueConstraint("conversation_id", "sequence"), sa.UniqueConstraint("conversation_id", "request_id"),
        sa.CheckConstraint("status IN ('pending','completed','failed')", name="ck_turn_status"),
        sa.CheckConstraint("status != 'completed' OR (reply IS NOT NULL AND length(reply) > 0)", name="ck_turn_reply"),
        sa.CheckConstraint("sequence > 0", name="ck_turn_sequence"))
    op.create_index("ix_dialogue_turns_conversation_id", "dialogue_turns", ["conversation_id"])
    op.create_index("uq_dialogue_pending", "dialogue_turns", ["conversation_id"], unique=True, postgresql_where=sa.text("status = 'pending'"))
    knowledge = op.create_table("scenario_knowledge",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("scenario_id", sa.String(50), sa.ForeignKey("scenarios.id"), nullable=False),
        sa.Column("keywords", pg.ARRAY(sa.Text()), nullable=False), sa.Column("context", sa.Text(), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False), sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False))
    op.create_index("ix_scenario_knowledge_scenario_id", "scenario_knowledge", ["scenario_id"])
    questions = op.create_table("interview_questions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("scenario_id", sa.String(50), sa.ForeignKey("scenarios.id"), nullable=False),
        sa.Column("text", sa.Text(), nullable=False), sa.Column("topic", sa.String(100), nullable=False),
        sa.Column("difficulty", sa.String(30), nullable=False), sa.Column("reference_answer", sa.Text(), nullable=False),
        sa.Column("required_points", pg.JSONB(), nullable=False), sa.Column("common_errors", pg.JSONB(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False), sa.Column("enabled", sa.Boolean(), nullable=False))
    op.create_index("ix_interview_questions_scenario_id", "interview_questions", ["scenario_id"])
    links = op.create_table("interview_question_knowledge",
        sa.Column("question_id", sa.String(36), sa.ForeignKey("interview_questions.id"), primary_key=True),
        sa.Column("knowledge_id", sa.String(36), sa.ForeignKey("scenario_knowledge.id"), primary_key=True))
    op.create_table("interview_attempts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("player_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("scenario_id", sa.String(50), sa.ForeignKey("scenarios.id"), nullable=False),
        sa.Column("request_id", sa.String(36), nullable=False), sa.Column("status", sa.String(30), nullable=False),
        sa.Column("report_text", sa.Text()), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("evaluation_id", sa.String(36)), sa.Column("evaluation_expires_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("player_id", "request_id"),
        sa.CheckConstraint("status IN ('in_progress','ready_for_evaluation','evaluating','completed','evaluation_failed')", name="ck_attempt_status"))
    op.create_table("interview_items",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("attempt_id", sa.String(36), sa.ForeignKey("interview_attempts.id"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("question_id", sa.String(36), sa.ForeignKey("interview_questions.id"), nullable=False),
        sa.Column("snapshot", pg.JSONB(), nullable=False), sa.Column("answer", sa.Text()),
        sa.Column("answer_request_id", sa.String(36)), sa.Column("evaluation_status", sa.String(20), nullable=False),
        sa.Column("evaluation", pg.JSONB(none_as_null=True)), sa.Column("evaluator_version", sa.String(30)),
        sa.Column("generation_id", sa.String(36)), sa.Column("expires_at", sa.DateTime(timezone=True)), sa.Column("error", sa.Text()),
        sa.UniqueConstraint("attempt_id", "position"), sa.UniqueConstraint("attempt_id", "question_id"),
        sa.UniqueConstraint("attempt_id", "answer_request_id"),
        sa.CheckConstraint("position BETWEEN 1 AND 4", name="ck_item_position"),
        sa.CheckConstraint("evaluation_status IN ('pending','evaluating','completed','failed')", name="ck_item_status"),
        sa.CheckConstraint("evaluation_status != 'completed' OR evaluation IS NOT NULL", name="ck_item_result"),
        sa.CheckConstraint("evaluation IS NULL OR (evaluation ?& ARRAY['relevance','correctness','completeness'] AND jsonb_typeof(evaluation->'relevance') = 'number' AND (evaluation->>'relevance')::numeric IN (0,1,2) AND jsonb_typeof(evaluation->'correctness') = 'number' AND (evaluation->>'correctness')::numeric IN (0,1,2) AND jsonb_typeof(evaluation->'completeness') = 'number' AND (evaluation->>'completeness')::numeric IN (0,1,2))", name="ck_item_scores"))
    op.create_index("ix_interview_items_attempt_id", "interview_items", ["attempt_id"])
    # Компактные исходные материалы: один вопрос и один фрагмент на тему.
    pool = [
        ("Транзакции", ["транзакция", "откат", "rollback", "commit"],
         "Транзакция объединяет операции в атомарное целое: COMMIT фиксирует изменения, ROLLBACK отменяет их. При ошибке изменения незавершённой транзакции откатывают.",
         "Для чего нужна транзакция и что делать при ошибке внутри неё?",
         ["Объединяет операции в атомарное целое", "COMMIT фиксирует изменения", "При ошибке ROLLBACK отменяет изменения"],
         ["Утверждение, что COMMIT отменяет изменения"]),
        ("Индексы", ["индекс", "index", "поиск в таблице"],
         "Индекс ускоряет подходящие запросы поиска, но занимает место и увеличивает стоимость INSERT, UPDATE и DELETE. Планировщик может выбрать последовательное чтение.",
         "Зачем нужен индекс в PostgreSQL и какова цена его использования?",
         ["Ускоряет подходящие запросы", "Занимает место", "Замедляет изменения данных из-за поддержки индекса"],
         ["Любой индекс ускоряет каждый запрос"]),
        ("Параметры SQL", ["sql инъекция", "параметризованный запрос", "sql injection"],
         "Параметризованные SQL-запросы передают значения отдельно от текста SQL. Конкатенация пользовательского ввода с SQL допускает инъекции. Имена таблиц требуют отдельного разрешённого списка.",
         "Как параметризованные запросы защищают от SQL-инъекции?",
         ["Значения передаются отдельно от SQL", "Ввод не интерпретируется как SQL-код", "Нельзя склеивать SQL с пользовательским вводом"],
         ["Достаточно удалить все пробелы из ввода"]),
        ("Асинхронность", ["async", "await", "асинхронность", "event loop"],
         "В Python await уступает управление event loop на время асинхронного ожидания. Блокирующие операции внутри async-функции блокируют цикл. Асинхронность сама по себе не ускоряет вычисления CPU.",
         "Что делает await и почему блокирующий вызов вреден в async-функции?",
         ["Уступает управление при ожидании", "Блокирующий вызов задерживает event loop", "Асинхронность не означает ускорение CPU-вычислений"],
         ["async автоматически запускает функцию в отдельном потоке"]),
        ("HTTP идемпотентность", ["идемпотентность", "request_id", "повтор запроса"],
         "Идемпотентная операция при повторе не дублирует побочные эффекты. Сервер хранит ключ запроса и результат; тот же ключ с другим содержимым отклоняется. Уникальность и транзакция защищают от гонки.",
         "Как избежать двойного сохранения при повторе HTTP-запроса после потери ответа?",
         ["Стабильный ключ запроса при повторе", "Сохранить результат и вернуть его без повторного эффекта", "Транзакция и уникальность защищают от одновременных повторов"],
         ["На каждом повторе нужно создавать новый ключ"]),
        ("Внешние ключи", ["внешний ключ", "foreign key", "ссылочная целостность"],
         "Внешний ключ обеспечивает ссылочную целостность: значение ссылается на существующую строку. Поведение при удалении родителя задаётся явно, например RESTRICT или CASCADE.",
         "Что обеспечивает внешний ключ и что может происходить при удалении родительской строки?",
         ["Ссылка только на существующую строку", "Удаление может запрещаться", "CASCADE может удалить зависимые строки"],
         ["Внешний ключ автоматически разрешает любую ссылку"]),
    ]
    for n, (topic, aliases, context, question, points, errors) in enumerate(pool, 1):
        kid = f"10000000-0000-4000-8000-{n:012d}"
        qid = f"20000000-0000-4000-8000-{n:012d}"
        op.bulk_insert(knowledge, [dict(id=kid, scenario_id="interview", keywords=aliases, context=context, priority=10, enabled=True, version=1)])
        op.bulk_insert(questions, [dict(id=qid, scenario_id="interview", text=question, topic=topic, difficulty="basic", reference_answer=context, required_points=points, common_errors=errors, enabled=True, version=1)])
        op.bulk_insert(links, [dict(question_id=qid, knowledge_id=kid)])


def downgrade():
    for name in ("interview_items", "interview_attempts", "interview_question_knowledge", "interview_questions", "scenario_knowledge", "dialogue_turns", "conversations"):
        op.drop_table(name)

