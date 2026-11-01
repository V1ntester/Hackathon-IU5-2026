"""Общая тема интервью и её снимок в попытке."""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("interview_settings",
        sa.Column("scenario_id", sa.String(50), sa.ForeignKey("scenarios.id"), primary_key=True),
        sa.Column("topic", sa.String(100), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("interview_attempts", sa.Column("topic", sa.String(100), nullable=True))
    # У существующих попыток общий пул: их тема остаётся NULL.
    op.execute("INSERT INTO interview_settings (scenario_id, topic, version) SELECT id, NULL, 1 FROM scenarios")


def downgrade():
    op.drop_column("interview_attempts", "topic")
    op.drop_table("interview_settings")
