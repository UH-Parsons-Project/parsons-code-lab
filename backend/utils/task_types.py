"""Shared task type definitions and database helpers."""

import re
import unicodedata

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import TaskType


DEFAULT_TASK_TYPES = (
    ("algorithms", "Algorithms"),
    ("arithmetic", "Arithmetic"),
    ("booleans", "Booleans"),
    ("classes", "Classes"),
    ("comprehensions", "Comprehensions"),
    ("conditionals", "Conditionals"),
    ("debugging", "Debugging"),
    ("dictionaries", "Dictionaries"),
    ("exceptions", "Exceptions"),
    ("files", "Files"),
    ("functions", "Functions"),
    ("imports", "Imports"),
    ("input", "Input"),
    ("lists", "Lists"),
    ("loops", "Loops"),
    ("other", "Other"),
    ("recursion", "Recursion"),
    ("searching", "Searching"),
    ("sets", "Sets"),
    ("sorting", "Sorting"),
    ("strings", "Strings"),
    ("testing", "Testing"),
    ("tuples", "Tuples"),
    ("typecasting", "Typecasting"),
    ("variables", "Variables"),
)

# These values were written by older versions of the application. They remain
# in the database as inactive entries so existing tasks can keep their value,
# but they are not offered for new tasks.
LEGACY_TASK_TYPES = (
    ("normal", "Normal (legacy)"),
    ("faded", "Faded (legacy)"),
    ("python", "Python (legacy)"),
    ("parsons", "Parsons (legacy)"),
)


def normalize_label(label: str | None) -> str:
    """Trim and collapse whitespace in a task type label."""
    return " ".join((label or "").split())


def slugify_task_type(value: str | None) -> str:
    """Convert a task type label/value into a stable lowercase slug."""
    normalized = unicodedata.normalize("NFKD", value or "")
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", ascii_value.lower()).strip("-")


def legacy_value_for_slug(slug: str) -> str:
    """Return the historical casing used by old task records."""
    return "Faded" if slug == "faded" else slug


async def ensure_default_task_types(db: AsyncSession) -> None:
    """Insert default and legacy task types when a development DB is empty."""
    result = await db.execute(select(TaskType.slug))
    existing_slugs = {slug.lower() for slug in result.scalars().all()}

    for slug, label in (*DEFAULT_TASK_TYPES, *LEGACY_TASK_TYPES):
        if slug in existing_slugs:
            continue
        db.add(
            TaskType(
                slug=slug,
                label=label,
                is_active=slug not in {legacy[0] for legacy in LEGACY_TASK_TYPES},
            )
        )
    await db.flush()


async def find_task_type(
    db: AsyncSession,
    value: str,
    *,
    include_inactive: bool = False,
) -> TaskType | None:
    """Find a task type case-insensitively by slug."""
    statement = select(TaskType).where(func.lower(TaskType.slug) == value.lower())
    if not include_inactive:
        statement = statement.where(TaskType.is_active.is_(True))
    result = await db.execute(statement)
    return result.scalar_one_or_none()
