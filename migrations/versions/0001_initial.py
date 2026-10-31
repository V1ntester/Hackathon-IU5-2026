"""Гости, игровая статистика и начальный сценарий собеседования."""
from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "users",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("display_name", sa.String(40), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "player_stats",
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("connections", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("text_requests", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("voice_requests", sa.Integer(), nullable=False, server_default="0"),
        sa.CheckConstraint("connections >= 0", name="ck_stats_connections"),
        sa.CheckConstraint("text_requests >= 0", name="ck_stats_text"),
        sa.CheckConstraint("voice_requests >= 0", name="ck_stats_voice"),
    )
    scenario_table = op.create_table(
        "scenarios",
        sa.Column("id", sa.String(50), primary_key=True),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("system_prompt", sa.Text(), nullable=False),
    )
    op.bulk_insert(scenario_table, [{
        "id": "interview",
        "title": "Собеседование",
        "description": "Практика ответов на вопросы NPC-рекрутера.",
        "system_prompt": "Ты NPC-рекрутер в игре для практики собеседований. "
                         "Отвечай по-русски кратко и доброжелательно. "
                         "Реагируй на ответ кандидата и задай один уточняющий вопрос. "
                         "Не выдумывай факты о кандидате. /no_think",
    }])


def downgrade():
    op.drop_table("scenarios")
    op.drop_table("player_stats")
    op.drop_table("users")
