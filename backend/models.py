"""
Database models for the application.
"""

from datetime import datetime, timezone

import bcrypt
from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from . import config
from .database import Base


def utc_now() -> datetime:
    """Return current UTC datetime."""
    return datetime.now(timezone.utc)


class Teacher(Base):
    """Teacher account model."""

    __tablename__ = "teachers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_admin_teacher: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    def set_password(self, password: str) -> None:
        """Hash and set the password."""
        rounds = 4 if config.TEST_MODE else 12
        self.password_hash = bcrypt.hashpw(
            password.encode("utf-8"), bcrypt.gensalt(rounds=rounds)
        ).decode("utf-8")

    def verify_password(self, password: str) -> bool:
        """Verify a password against the stored hash."""
        return bcrypt.checkpw(
            password.encode("utf-8"), self.password_hash.encode("utf-8")
        )


class Parsons(Base):
    """Parsons problem task model."""

    __tablename__ = "parsons"
    __table_args__ = (UniqueConstraint("created_by_teacher_id", "title"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    created_by_teacher_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("teachers.id"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    task_instructions: Mapped[str] = mapped_column(String(None), nullable=False)
    description: Mapped[str | None] = mapped_column(String(None), nullable=True)
    task_type: Mapped[str] = mapped_column(String(50), nullable=False)
    code_blocks: Mapped[dict] = mapped_column(JSON, nullable=False)
    correct_solution: Mapped[dict] = mapped_column(JSON, nullable=False)
    faded: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    is_public: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )


class TaskType(Base):
    """A configurable task type tag."""

    __tablename__ = "task_types"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class TaskSet(Base):
    """Task list model."""

    __tablename__ = "task_sets"

    __table_args__ = (
        UniqueConstraint("teacher_id", "title"),
        UniqueConstraint("teacher_id", "unique_link_code"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    teacher_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("teachers.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    unique_link_code: Mapped[str] = mapped_column(String(50), nullable=False)
    student_description: Mapped[str | None] = mapped_column(String(None), nullable=True)
    teacher_description: Mapped[str | None] = mapped_column(String(None), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    opens_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class TaskSetViewer(Base):
    """Teachers who can view a task set."""

    __tablename__ = "task_set_viewers"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_set_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("task_sets.id", ondelete="CASCADE"), nullable=False
    )
    teacher_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("teachers.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class TaskSetItem(Base):
    """Task list item model."""

    __tablename__ = "task_set_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_set_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("task_sets.id", ondelete="CASCADE"), nullable=False
    )
    task_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("parsons.id", ondelete="CASCADE"), nullable=False
    )
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)


class TeacherFavoriteTask(Base):
    """Tasks a teacher has marked as favorites."""

    __tablename__ = "teacher_favorite_tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    teacher_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("teachers.id", ondelete="CASCADE"), nullable=False
    )
    task_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("parsons.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    __table_args__ = (UniqueConstraint("teacher_id", "task_id"),)


class Student(Base):
    """Student user model."""

    __tablename__ = "student"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str | None] = mapped_column(String(20), unique=False, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    session_token: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True, index=True)
    student_created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )
    student_updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    last_activity_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    def set_password(self, password: str) -> None:
        """Hash and set the password."""
        rounds = 4 if config.TEST_MODE else 12
        self.password_hash = bcrypt.hashpw(
            password.encode("utf-8"), bcrypt.gensalt(rounds=rounds)
        ).decode("utf-8")

    def verify_password(self, password: str) -> bool:
        """Verify a password against the stored hash."""
        return bcrypt.checkpw(
            password.encode("utf-8"), self.password_hash.encode("utf-8")
        )


class StudentTaskSetEnrollment(Base):
    """Association between a student and a task set they have joined."""

    __tablename__ = "student_task_set_enrollments"

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("student.id", ondelete="CASCADE"), nullable=False
    )
    task_set_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("task_sets.id", ondelete="CASCADE"), nullable=False
    )
    enrolled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    __table_args__ = (UniqueConstraint("student_id", "task_set_id"),)


class StudentTaskEnrollment(Base):
    """Student enrollment in a task within a task set."""

    __tablename__ = "student_task_enrollments"

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("student.id", ondelete="CASCADE"), nullable=False
    )
    task_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("parsons.id", ondelete="CASCADE"), nullable=False
    )
    task_set_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("task_sets.id", ondelete="CASCADE"), nullable=False
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    __table_args__ = (UniqueConstraint("student_id", "task_id", "task_set_id"),)


class TaskSession(Base):
    """One visit to a task page — records entry and exit time."""

    __tablename__ = "task_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    student_task_enrollment_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("student_task_enrollments.id", ondelete="CASCADE"), nullable=False
    )
    entered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    exited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    exit_reason: Mapped[str | None] = mapped_column(String(50), nullable=True)


class TaskAttempt(Base):
    """Student attempt for a specific task."""

    __tablename__ = "task_attempts"

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("student.id", ondelete="CASCADE"), nullable=False
    )
    task_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("parsons.id", ondelete="CASCADE"), nullable=False
    )
    student_task_enrollment_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("student_task_enrollments.id", ondelete="CASCADE"), nullable=False
    )
    task_session_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("task_sessions.id", ondelete="SET NULL"), nullable=True
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
    block_id: Mapped[str] = mapped_column(String(255), nullable=False)
    from_container: Mapped[str] = mapped_column(String(50), nullable=False)
    to_container: Mapped[str] = mapped_column(String(50), nullable=False)
    from_index: Mapped[int] = mapped_column(Integer, nullable=False)
    to_index: Mapped[int] = mapped_column(Integer, nullable=False)
    from_indent: Mapped[int] = mapped_column(Integer, nullable=False)
    to_indent: Mapped[int] = mapped_column(Integer, nullable=False)
    event_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class EditEvent(Base):
    """Individual blank field edit event tied to a task attempt."""

    __tablename__ = "edit_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    attempt_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("task_attempts.id", ondelete="CASCADE"), nullable=False
    )
    block_id: Mapped[str] = mapped_column(String(255), nullable=False)
    blank_index: Mapped[int] = mapped_column(Integer, nullable=False)
    value: Mapped[str] = mapped_column(String(1000), nullable=False)
    event_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class RegistrationToken(Base):
    """Registration token for teacher account creation."""

    __tablename__ = "registration_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    created_by_admin_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("teachers.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    def verify_token(self, token: str) -> bool:
        import hashlib
        return hashlib.sha256(token.encode("utf-8")).hexdigest() == self.token_hash

    def is_expired(self) -> bool:
        expires = self.expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) > expires


class ModelAnswer(Base):
    """Teacher-provided model answer for a Parsons task."""

    __tablename__ = "model_answers"

    id: Mapped[int] = mapped_column(primary_key=True)
    parsons_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("parsons.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    created_by_teacher_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("teachers.id"), nullable=False
    )
    answer_code: Mapped[str] = mapped_column(String(None), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )
