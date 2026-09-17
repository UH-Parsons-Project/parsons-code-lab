"""Add database-backed task type tags.

Revision ID: 7a91c6e4b2d8
Revises: d1e2f3a4b5c6
Create Date: 2026-08-17

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "7a91c6e4b2d8"
down_revision: Union[str, Sequence[str], None] = "d1e2f3a4b5c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


DEFAULT_TASK_TYPES = (
    ("algorithms", "Algorithms", True, 10),
    ("arithmetic", "Arithmetic", True, 20),
    ("booleans", "Booleans", True, 30),
    ("classes", "Classes", True, 40),
    ("comprehensions", "Comprehensions", True, 50),
    ("conditionals", "Conditionals", True, 60),
    ("debugging", "Debugging", True, 70),
    ("dictionaries", "Dictionaries", True, 80),
    ("exceptions", "Exceptions", True, 90),
    ("files", "Files", True, 100),
    ("functions", "Functions", True, 110),
    ("imports", "Imports", True, 120),
    ("input", "Input", True, 130),
    ("lists", "Lists", True, 140),
    ("loops", "Loops", True, 150),
    ("other", "Other", True, 160),
    ("recursion", "Recursion", True, 170),
    ("searching", "Searching", True, 180),
    ("sets", "Sets", True, 190),
    ("sorting", "Sorting", True, 200),
    ("strings", "Strings", True, 210),
    ("testing", "Testing", True, 220),
    ("tuples", "Tuples", True, 230),
    ("typecasting", "Typecasting", True, 240),
    ("variables", "Variables", True, 250),
    ("normal", "Normal (legacy)", False, 9000),
    ("faded", "Faded (legacy)", False, 9010),
    ("python", "Python (legacy)", False, 9020),
    ("parsons", "Parsons (legacy)", False, 9030),
)


def upgrade() -> None:
    task_types = op.create_table(
        "task_types",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("slug", sa.String(length=50), nullable=False),
        sa.Column("label", sa.String(length=100), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug"),
    )

    op.bulk_insert(
        task_types,
        [
            {
                "slug": slug,
                "label": label,
                "is_active": is_active,
                "sort_order": sort_order,
            }
            for slug, label, is_active, sort_order in DEFAULT_TASK_TYPES
        ],
    )


def downgrade() -> None:
    op.drop_table("task_types")
