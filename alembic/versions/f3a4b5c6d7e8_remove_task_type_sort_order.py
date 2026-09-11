"""Remove task type display ordering.

Revision ID: 8b2d6f1a4c9e
Revises: 7a91c6e4b2d8
Create Date: 2026-08-25

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "8b2d6f1a4c9e"
down_revision: Union[str, Sequence[str], None] = "7a91c6e4b2d8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("task_types", "sort_order")


def downgrade() -> None:
    op.add_column(
        "task_types",
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
    )
