"""Accounts and initial users."""
from uuid import uuid4
from alembic import op
import sqlalchemy as sa
from backend.services.auth import hash_password

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("nickname", sa.String(40), nullable=True))
    op.create_unique_constraint("uq_users_nickname", "users", ["nickname"])
    op.add_column("users", sa.Column("password_hash", sa.String(200), nullable=True))
    op.add_column("users", sa.Column("role", sa.String(16), nullable=False, server_default="guest"))
    connection = op.get_bind()
    for name in ("admin", "ryab", "shan", "nika"):
        user_id = str(uuid4())
        connection.execute(sa.text("INSERT INTO users (id, display_name, nickname, password_hash, role, created_at) VALUES (:id,:name,:name,:hash,:role,now())"),
            {"id": user_id, "name": name, "hash": hash_password("root"), "role": "admin" if name == "admin" else "guest"})
        connection.execute(sa.text("INSERT INTO player_stats (user_id) VALUES (:id)"), {"id": user_id})


def downgrade():
    op.drop_column("users", "role")
    op.drop_column("users", "password_hash")
    op.drop_constraint("uq_users_nickname", "users", type_="unique")
    op.drop_column("users", "nickname")
