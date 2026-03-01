"""
Database models for the application.
"""

from datetime import datetime, timezone
from uuid import UUID

import bcrypt
from sqlalchemy import JSON,Boolean, DateTime, ForeignKey, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


def utc_now() -> datetime:
    """Return current UTC datetime."""
    return datetime.now(timezone.utc)


class Teacher(Base):
    """Teacher user model."""

    __tablename__ = "teachers"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    def set_password(self, password: str) -> None:
        """Hash and set the password."""
        self.password_hash = bcrypt.hashpw(
            password.encode("utf-8"), bcrypt.gensalt()
        ).decode("utf-8")

    def verify_password(self, password: str) -> bool:
        """Verify a password against the stored hash."""
        return bcrypt.checkpw(
            password.encode("utf-8"), self.password_hash.encode("utf-8")
        )


class Parsons(Base):
    """Parsons problem task model."""

    __tablename__ = "parsons"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_by_teacher_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("teachers.id"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(String(None), nullable=False)
    task_instructions: Mapped[str] = mapped_column(String(None), nullable=True)
    task_type: Mapped[str] = mapped_column(String(50), nullable=False)
    code_blocks: Mapped[dict] = mapped_column(JSON, nullable=False)
    correct_solution: Mapped[dict] = mapped_column(JSON, nullable=False)
    is_public: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )


class TaskList(Base):
    """Task list model."""

    __tablename__ = "task_lists"

    id: Mapped[int] = mapped_column(primary_key=True)
    teacher_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("teachers.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    unique_link_code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class TaskListItem(Base):
    """Task list item model."""

    __tablename__ = "task_list_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_list_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("task_lists.id", ondelete="CASCADE"), nullable=False
    )
    task_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("parsons.id", ondelete="CASCADE"), nullable=False
    )


class StudentSession(Base):
    """Student session model."""

    __tablename__ = "student_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[UUID] = mapped_column(Uuid, unique=True, nullable=False)
    task_list_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("task_lists.id", ondelete="SET NULL"), nullable=True
    )
    username: Mapped[str | None] = mapped_column(String(20), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    last_activity_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )


class TaskAttempt(Base):
    """Student attempt for a specific task."""

    __tablename__ = "task_attempts"

    id: Mapped[int] = mapped_column(primary_key=True)
    student_session_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("student_sessions.id", ondelete="CASCADE"), nullable=False
    )
    task_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("parsons.id", ondelete="CASCADE"), nullable=False
    )
    task_started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    success: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    submitted_order: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    submitted_inputs: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class MoveEvent(Base):
    """Individual move event tied to a task attempt."""

    __tablename__ = "move_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    attempt_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("task_attempts.id", ondelete="CASCADE"), nullable=False
    )
    event_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
