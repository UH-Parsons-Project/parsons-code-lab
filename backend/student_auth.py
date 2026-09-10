"""
Student session management utilities.
"""

import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from fastapi import Cookie, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .database import get_db
from .models import Student, StudentTaskSetEnrollment
from . import config

STUDENT_SESSION_EXPIRE_HOURS = 168

async def create_student_session(
    task_set_id: int,
    nickname: str,
    db: AsyncSession
) -> Student:
    """
    Create a new student record for nickname-based entry.
    Returns the Student object with session_token set.
    """
    student = Student(
        username=nickname,
        email=f"guest-{secrets.token_hex(12)}@local.student",
        session_token=secrets.token_urlsafe(32),
        started_at=datetime.now(timezone.utc),
        last_activity_at=datetime.now(timezone.utc)
    )
    student.set_password(secrets.token_urlsafe(24))

    db.add(student)
    await db.flush()

    enrollment = StudentTaskSetEnrollment(
        student_id=student.id,
        task_set_id=task_set_id,
    )
    db.add(enrollment)
    await db.commit()
    await db.refresh(student)

    return student


async def get_student_session(
    session_token: Optional[str],
    db: AsyncSession,
    check_expiry: bool = True,
    update_activity: bool = True
) -> Optional[Student]:
    """
    Retrieve a student from an opaque session token cookie.
    Returns None if session not found or expired.
    """
    if not session_token:
        return None

    result = await db.execute(
        select(Student).where(Student.session_token == session_token)
    )
    student = result.scalar_one_or_none()

    if not student:
        return None

    if check_expiry:
        expiry_threshold = datetime.now(timezone.utc) - timedelta(hours=STUDENT_SESSION_EXPIRE_HOURS)
        last_activity = student.last_activity_at
        if last_activity.tzinfo is None:
            last_activity = last_activity.replace(tzinfo=timezone.utc)
        if last_activity < expiry_threshold:
            return None

    if update_activity:
        student.last_activity_at = datetime.now(timezone.utc)
        await db.commit()

    return student


def set_session_cookie(
    response: Response,
    token: str,
    max_age_hours: Optional[int] = None
) -> None:
    """
    Set a persistent session cookie holding an opaque random token.
    """
    if max_age_hours is None:
        max_age_hours = STUDENT_SESSION_EXPIRE_HOURS

    response.set_cookie(
        key="student_session",
        value=token,
        path="/",
        httponly=True,
        secure=config.COOKIE_SECURE,
        samesite="lax",
        max_age=max_age_hours * 3600
    )


async def get_current_student_session(
    student_session: Optional[str] = Cookie(None, alias="student_session"),
    db: AsyncSession = Depends(get_db)
) -> Optional[Student]:
    """
    Dependency to get the current student session if it exists.
    Returns None if no valid session found (does not raise exception).
    Updates last_activity_at timestamp.
    """
    return await get_student_session(student_session, db, update_activity=True)


async def get_current_student_session_no_update(
    student_session: Optional[str] = Cookie(None, alias="student_session"),
    db: AsyncSession = Depends(get_db)
) -> Optional[Student]:
    """
    Dependency to get the current student session if it exists.
    Returns None if no valid session found (does not raise exception).
    Does NOT update last_activity_at (lightweight check for redirects).
    """
    return await get_student_session(student_session, db, update_activity=False)


async def authenticate_student(identifier: str, password: str, db: AsyncSession) -> Optional[Student]:
    """
    Authenticate a student by username or email and password.
    Returns the Student object if valid, None otherwise.
    """
    result = await db.execute(
        select(Student).where(Student.email == identifier)
    )
    student = result.scalar_one_or_none()

    if not student or not student.is_active:
        return None

    if not student.verify_password(password):
        return None

    return student


async def require_student_session(
    student_session: Optional[str] = Cookie(None, alias="student_session"),
    db: AsyncSession = Depends(get_db)
) -> Student:
    """
    Dependency to require a valid student session.
    Raises HTTPException if session is invalid or not found.
    """
    session = await get_student_session(student_session, db)

    if not session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in required to access this resource"
        )

    return session
