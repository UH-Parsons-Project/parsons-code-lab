"""Add teacher_pinned_task_sets

Revision ID: c7d8e9f0a1b2
Revises: 9c7e1a2b4d6f
Create Date: 2026-10-08 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c7d8e9f0a1b2"
down_revision: Union[str, Sequence[str], None] = "9c7e1a2b4d6f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "teacher_pinned_task_sets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("teacher_id", sa.Integer(), sa.ForeignKey("teachers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("task_set_id", sa.Integer(), sa.ForeignKey("task_sets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("teacher_id", "task_set_id"),
    )


def downgrade() -> None:
    op.drop_table("teacher_pinned_task_sets")
