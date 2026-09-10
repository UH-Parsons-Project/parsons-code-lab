"""Add faded flag to parsons.

Revision ID: f3a4b5c6d7e8
Revises: e2f3a4b5c6d7
Create Date: 2026-08-20 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = "f3a4b5c6d7e8"
down_revision: Union[str, Sequence[str], None] = "e2f3a4b5c6d7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add the persisted faded-task flag with the model's default."""
    op.execute(
        """
        ALTER TABLE parsons
        ADD COLUMN IF NOT EXISTS faded BOOLEAN NOT NULL DEFAULT FALSE
        """
    )


def downgrade() -> None:
    """Remove the persisted faded-task flag."""
    op.execute("ALTER TABLE parsons DROP COLUMN IF EXISTS faded")