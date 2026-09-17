"""Merge the task-type and main migration branches.

Revision ID: 9c7e1a2b4d6f
Revises: b3c4d5e6f7a8, 8b2d6f1a4c9e
Create Date: 2026-09-11

"""
from typing import Sequence, Union


revision: str = "9c7e1a2b4d6f"
down_revision: Union[str, Sequence[str], None] = (
    "b3c4d5e6f7a8",
    "8b2d6f1a4c9e",
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Merge two migration branches without changing database data."""


def downgrade() -> None:
    """Split the migration graph back into its two parent branches."""
