"""Add opens_at to task_sets

Revision ID: b3c4d5e6f7a8
Revises: f3a4b5c6d7e8
Create Date: 2026-08-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b3c4d5e6f7a8'
down_revision: Union[str, Sequence[str], None] = 'f3a4b5c6d7e8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add opens_at column to task_sets."""
    op.add_column(
        'task_sets',
        sa.Column('opens_at', sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    """Remove opens_at column from task_sets."""
    op.drop_column('task_sets', 'opens_at')
