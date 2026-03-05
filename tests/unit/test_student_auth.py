"""
Unit tests for student_auth.py - Student session management utilities.
"""

import uuid
import pytest
from datetime import datetime, timezone, timedelta
from fastapi import status, HTTPException
from sqlalchemy import select
from unittest.mock import MagicMock

from backend.student_auth import (
    create_student_session,
    get_student_session,
    set_session_cookie,
    get_current_student_session,
    get_current_student_session_no_update,
    require_student_session,
    STUDENT_SESSION_EXPIRE_HOURS,
)
from backend.models import StudentSession, TaskList


class TestCreateStudentSession:
    """Tests for create_student_session function."""

    async def test_create_student_session_creates_new_session(
        self, db_session, test_teacher
    ):
        """Test that create_student_session creates a new session with required fields."""
        # Create a task list first
        task_list = TaskList(
            title="Test List",
            unique_link_code="CREATE01",
            teacher_id=test_teacher.id,
        )
        db_session.add(task_list)
        await db_session.commit()
        await db_session.refresh(task_list)

        # Create student session
        session = await create_student_session(
            task_list_id=task_list.id,
            nickname="TestStudent",
            db=db_session,
        )

        assert session.id is not None
        assert session.session_id is not None
        assert isinstance(session.session_id, uuid.UUID)
        assert session.task_list_id == task_list.id
        assert session.username == "TestStudent"
        assert session.started_at is not None
        assert session.last_activity_at is not None

    async def test_create_student_session_generates_unique_session_ids(
        self, db_session, test_teacher
    ):
        """Test that each call generates a unique session_id."""
        task_list = TaskList(
            title="Test List",
            unique_link_code="CREATE02",
            teacher_id=test_teacher.id,
        )
        db_session.add(task_list)
        await db_session.commit()
        await db_session.refresh(task_list)

        session1 = await create_student_session(
            task_list_id=task_list.id,
            nickname="Student1",
            db=db_session,
        )
        session2 = await create_student_session(
            task_list_id=task_list.id,
            nickname="Student2",
            db=db_session,
        )

        assert session1.session_id != session2.session_id

    async def test_create_student_session_persists_to_database(
        self, db_session, test_teacher
    ):
        """Test that the created session is persisted to the database."""
        task_list = TaskList(
            title="Test List",
            unique_link_code="CREATE03",
            teacher_id=test_teacher.id,
        )
        db_session.add(task_list)
        await db_session.commit()
        await db_session.refresh(task_list)

        session_id = uuid.uuid4()
        session = await create_student_session(
            task_list_id=task_list.id,
            nickname="PersistTest",
            db=db_session,
        )

        # Query the database to verify it was saved
        result = await db_session.execute(
            select(StudentSession).where(StudentSession.session_id == session.session_id)
        )
        retrieved_session = result.scalar_one_or_none()

        assert retrieved_session is not None
        assert retrieved_session.session_id == session.session_id
        assert retrieved_session.username == "PersistTest"


class TestGetStudentSession:
    """Tests for get_student_session function."""

    async def test_get_student_session_with_none_token_returns_none(self, db_session):
        """Test that None token returns None."""
        result = await get_student_session(None, db_session)
        assert result is None

    async def test_get_student_session_with_empty_token_returns_none(self, db_session):
        """Test that empty string token returns None."""
        result = await get_student_session("", db_session)
        assert result is None

    async def test_get_student_session_with_invalid_uuid_returns_none(self, db_session):
        """Test that invalid UUID string returns None."""
        result = await get_student_session("not-a-uuid", db_session)
        assert result is None

    async def test_get_student_session_with_nonexistent_session_returns_none(
        self, db_session
    ):
        """Test that non-existent session token returns None."""
        fake_uuid = str(uuid.uuid4())
        result = await get_student_session(fake_uuid, db_session)
        assert result is None

    async def test_get_student_session_retrieves_existing_session(
        self, db_session, test_teacher
    ):
        """Test that existing session is retrieved correctly."""
        # Create task list and session
        task_list = TaskList(
            title="Test List",
            unique_link_code="GET01",
            teacher_id=test_teacher.id,
        )
        db_session.add(task_list)
        await db_session.commit()
        await db_session.refresh(task_list)

        created_session = await create_student_session(
            task_list_id=task_list.id,
            nickname="RetrieveTest",
            db=db_session,
        )

        # Retrieve the session
        retrieved_session = await get_student_session(
            str(created_session.session_id), db_session, check_expiry=False
        )

        assert retrieved_session is not None
        assert retrieved_session.session_id == created_session.session_id
        assert retrieved_session.username == "RetrieveTest"

    async def test_get_student_session_with_expiry_check_returns_none_if_expired(
        self, db_session, test_teacher
    ):
        """Test that expired session returns None when check_expiry=True."""
        # Create task list and session
        task_list = TaskList(
            title="Test List",
            unique_link_code="GET02",
            teacher_id=test_teacher.id,
        )
        db_session.add(task_list)
        await db_session.commit()
        await db_session.refresh(task_list)

        session = await create_student_session(
            task_list_id=task_list.id,
            nickname="ExpiredTest",
            db=db_session,
        )

        # Manually set last_activity_at to be older than expiry threshold
        old_time = datetime.now(timezone.utc) - timedelta(
            hours=STUDENT_SESSION_EXPIRE_HOURS + 1
        )
        session.last_activity_at = old_time
        await db_session.commit()

        # Try to retrieve with expiry check
        result = await get_student_session(
            str(session.session_id), db_session, check_expiry=True
        )

        assert result is None

    async def test_get_student_session_returns_valid_session_within_expiry(
        self, db_session, test_teacher
    ):
        """Test that valid session within expiry window is returned."""
        task_list = TaskList(
            title="Test List",
            unique_link_code="GET03",
            teacher_id=test_teacher.id,
        )
        db_session.add(task_list)
        await db_session.commit()
        await db_session.refresh(task_list)

        session = await create_student_session(
            task_list_id=task_list.id,
            nickname="ValidTest",
            db=db_session,
        )

        # Set last_activity_at to be recent
        recent_time = datetime.now(timezone.utc) - timedelta(hours=1)
        session.last_activity_at = recent_time
        await db_session.commit()

        # Try to retrieve with expiry check
        result = await get_student_session(
            str(session.session_id), db_session, check_expiry=True
        )

        assert result is not None
        assert result.session_id == session.session_id

    async def test_get_student_session_updates_last_activity_when_requested(
        self, db_session, test_teacher
    ):
        """Test that last_activity_at is updated when update_activity=True."""
        task_list = TaskList(
            title="Test List",
            unique_link_code="GET04",
            teacher_id=test_teacher.id,
        )
        db_session.add(task_list)
        await db_session.commit()
        await db_session.refresh(task_list)

        session = await create_student_session(
            task_list_id=task_list.id,
            nickname="UpdateTest",
            db=db_session,
        )

        old_activity_time = session.last_activity_at
        # Handle naive datetime from SQLite
        if old_activity_time.tzinfo is None:
            old_activity_time = old_activity_time.replace(tzinfo=timezone.utc)

        # Wait a moment and retrieve with update_activity=True
        import time
        time.sleep(0.1)

        before_update = datetime.now(timezone.utc)
        retrieved = await get_student_session(
            str(session.session_id), db_session, update_activity=True
        )
        after_update = datetime.now(timezone.utc)

        # Handle naive datetime from SQLite
        retrieved_activity = retrieved.last_activity_at
        if retrieved_activity.tzinfo is None:
            retrieved_activity = retrieved_activity.replace(tzinfo=timezone.utc)

        assert retrieved_activity > old_activity_time
        assert before_update <= retrieved.last_activity_at <= after_update

    async def test_get_student_session_does_not_update_when_not_requested(
        self, db_session, test_teacher
    ):
        """Test that last_activity_at is NOT updated when update_activity=False."""
        task_list = TaskList(
            title="Test List",
            unique_link_code="GET05",
            teacher_id=test_teacher.id,
        )
        db_session.add(task_list)
        await db_session.commit()
        await db_session.refresh(task_list)

        session = await create_student_session(
            task_list_id=task_list.id,
            nickname="NoUpdateTest",
            db=db_session,
        )

        original_activity_time = session.last_activity_at

        # Retrieve with update_activity=False
        import time
        time.sleep(0.1)

        retrieved = await get_student_session(
            str(session.session_id), db_session, check_expiry=False, update_activity=False
        )

        # Activity time should not change (within reasonable tolerance)
        assert retrieved.last_activity_at == original_activity_time


class TestSetSessionCookie:
    """Tests for set_session_cookie function."""

    def test_set_session_cookie_sets_cookie_with_defaults(self):
        """Test that set_session_cookie sets a cookie with correct default values."""
        response = MagicMock()
        session_id = uuid.uuid4()

        set_session_cookie(response, session_id)

        response.set_cookie.assert_called_once()
        call_args = response.set_cookie.call_args

        assert call_args.kwargs["key"] == "student_session"
        assert call_args.kwargs["value"] == str(session_id)
        assert call_args.kwargs["path"] == "/"
        assert call_args.kwargs["httponly"] is True
        assert call_args.kwargs["secure"] is False
        assert call_args.kwargs["samesite"] == "lax"
        assert call_args.kwargs["max_age"] == STUDENT_SESSION_EXPIRE_HOURS * 3600

    def test_set_session_cookie_with_custom_max_age_hours(self):
        """Test that set_session_cookie respects custom max_age_hours."""
        response = MagicMock()
        session_id = uuid.uuid4()
        custom_hours = 24

        set_session_cookie(response, session_id, max_age_hours=custom_hours)

        call_args = response.set_cookie.call_args
        assert call_args.kwargs["max_age"] == custom_hours * 3600

    def test_set_session_cookie_converts_session_id_to_string(self):
        """Test that session_id UUID is converted to string."""
        response = MagicMock()
        session_id = uuid.uuid4()

        set_session_cookie(response, session_id)

        call_args = response.set_cookie.call_args
        assert call_args.kwargs["value"] == str(session_id)
        assert isinstance(call_args.kwargs["value"], str)


class TestGetCurrentStudentSessionDependency:
    """Tests for get_current_student_session dependency."""

    async def test_get_current_student_session_returns_none_without_cookie(
        self, db_session
    ):
        """Test that dependency returns None when no session cookie exists."""
        result = await get_current_student_session(student_session=None, db=db_session)
        assert result is None

    async def test_get_current_student_session_returns_valid_session(
        self, db_session, test_teacher
    ):
        """Test that dependency returns valid session from cookie."""
        task_list = TaskList(
            title="Test List",
            unique_link_code="DEP01",
            teacher_id=test_teacher.id,
        )
        db_session.add(task_list)
        await db_session.commit()
        await db_session.refresh(task_list)

        session = await create_student_session(
            task_list_id=task_list.id,
            nickname="DependencyTest",
            db=db_session,
        )

        result = await get_current_student_session(
            student_session=str(session.session_id), db=db_session
        )

        assert result is not None
        assert result.session_id == session.session_id

    async def test_get_current_student_session_updates_activity(
        self, db_session, test_teacher
    ):
        """Test that this dependency updates last_activity_at."""
        task_list = TaskList(
            title="Test List",
            unique_link_code="DEP02",
            teacher_id=test_teacher.id,
        )
        db_session.add(task_list)
        await db_session.commit()
        await db_session.refresh(task_list)

        session = await create_student_session(
            task_list_id=task_list.id,
            nickname="ActivityUpdateTest",
            db=db_session,
        )

        original_activity = session.last_activity_at

        import time
        time.sleep(0.1)

        before_call = datetime.now(timezone.utc)
        result = await get_current_student_session(
            student_session=str(session.session_id), db=db_session
        )
        after_call = datetime.now(timezone.utc)

        # Handle naive datetimes from SQLite
        result_activity = result.last_activity_at
        if result_activity.tzinfo is None:
            result_activity = result_activity.replace(tzinfo=timezone.utc)
        
        original_activity_fixed = original_activity
        if original_activity_fixed.tzinfo is None:
            original_activity_fixed = original_activity_fixed.replace(tzinfo=timezone.utc)

        assert result_activity > original_activity_fixed
        assert before_call <= result_activity <= after_call


class TestGetCurrentStudentSessionNoUpdateDependency:
    """Tests for get_current_student_session_no_update dependency."""

    async def test_get_current_student_session_no_update_returns_none_without_cookie(
        self, db_session
    ):
        """Test that dependency returns None when no session cookie exists."""
        result = await get_current_student_session_no_update(
            student_session=None, db=db_session
        )
        assert result is None

    async def test_get_current_student_session_no_update_returns_valid_session(
        self, db_session, test_teacher
    ):
        """Test that dependency returns valid session from cookie."""
        task_list = TaskList(
            title="Test List",
            unique_link_code="DEPNOUP01",
            teacher_id=test_teacher.id,
        )
        db_session.add(task_list)
        await db_session.commit()
        await db_session.refresh(task_list)

        session = await create_student_session(
            task_list_id=task_list.id,
            nickname="NoUpdateDepTest",
            db=db_session,
        )

        result = await get_current_student_session_no_update(
            student_session=str(session.session_id), db=db_session
        )

        assert result is not None
        assert result.session_id == session.session_id

    async def test_get_current_student_session_no_update_does_not_update_activity(
        self, db_session, test_teacher
    ):
        """Test that this dependency does NOT update last_activity_at."""
        task_list = TaskList(
            title="Test List",
            unique_link_code="DEPNOUP02",
            teacher_id=test_teacher.id,
        )
        db_session.add(task_list)
        await db_session.commit()
        await db_session.refresh(task_list)

        session = await create_student_session(
            task_list_id=task_list.id,
            nickname="NoActivityUpdateTest",
            db=db_session,
        )

        original_activity = session.last_activity_at

        import time
        time.sleep(0.1)

        result = await get_current_student_session_no_update(
            student_session=str(session.session_id), db=db_session
        )

        # Activity time should not change
        assert result.last_activity_at == original_activity


class TestRequireStudentSessionDependency:
    """Tests for require_student_session dependency."""

    async def test_require_student_session_raises_when_no_session(self, db_session):
        """Test that dependency raises HTTPException when no session exists."""
        with pytest.raises(HTTPException) as exc_info:
            await require_student_session(student_session=None, db=db_session)

        assert exc_info.value.status_code == status.HTTP_401_UNAUTHORIZED
        assert "session required" in exc_info.value.detail.lower()

    async def test_require_student_session_raises_when_session_expired(
        self, db_session, test_teacher
    ):
        """Test that dependency raises HTTPException when session is expired."""
        task_list = TaskList(
            title="Test List",
            unique_link_code="REQ01",
            teacher_id=test_teacher.id,
        )
        db_session.add(task_list)
        await db_session.commit()
        await db_session.refresh(task_list)

        session = await create_student_session(
            task_list_id=task_list.id,
            nickname="ExpiredRequireTest",
            db=db_session,
        )

        # Make session expired
        old_time = datetime.now(timezone.utc) - timedelta(
            hours=STUDENT_SESSION_EXPIRE_HOURS + 1
        )
        session.last_activity_at = old_time
        await db_session.commit()

        with pytest.raises(HTTPException) as exc_info:
            await require_student_session(
                student_session=str(session.session_id), db=db_session
            )

        assert exc_info.value.status_code == status.HTTP_401_UNAUTHORIZED

    async def test_require_student_session_returns_valid_session(
        self, db_session, test_teacher
    ):
        """Test that dependency returns valid session."""
        task_list = TaskList(
            title="Test List",
            unique_link_code="REQ02",
            teacher_id=test_teacher.id,
        )
        db_session.add(task_list)
        await db_session.commit()
        await db_session.refresh(task_list)

        session = await create_student_session(
            task_list_id=task_list.id,
            nickname="ValidRequireTest",
            db=db_session,
        )

        result = await require_student_session(
            student_session=str(session.session_id), db=db_session
        )

        assert result is not None
        assert result.session_id == session.session_id
        assert result.username == "ValidRequireTest"

    async def test_require_student_session_raises_with_invalid_uuid(self, db_session):
        """Test that dependency raises HTTPException with invalid UUID."""
        with pytest.raises(HTTPException) as exc_info:
            await require_student_session(student_session="not-a-uuid", db=db_session)

        assert exc_info.value.status_code == status.HTTP_401_UNAUTHORIZED


class TestSessionExpiryEdgeCases:
    """Tests for edge cases in session expiry and timezone handling."""

    async def test_get_student_session_handles_naive_datetime_from_sqlite(
        self, db_session, test_teacher
    ):
        """Test that function handles naive datetimes returned by SQLite."""
        task_list = TaskList(
            title="Test List",
            unique_link_code="EDGE01",
            teacher_id=test_teacher.id,
        )
        db_session.add(task_list)
        await db_session.commit()
        await db_session.refresh(task_list)

        session = await create_student_session(
            task_list_id=task_list.id,
            nickname="NaiveDatetimeTest",
            db=db_session,
        )

        # Set to naive datetime (simulating SQLite behavior)
        naive_time = datetime.now() - timedelta(hours=1)
        session.last_activity_at = naive_time
        await db_session.commit()

        # This should not raise an error even though last_activity_at is naive
        result = await get_student_session(
            str(session.session_id), db=db_session, check_expiry=True
        )

        assert result is not None

    async def test_get_student_session_at_expiry_boundary(self, db_session, test_teacher):
        """Test session behavior at the exact expiry boundary."""
        task_list = TaskList(
            title="Test List",
            unique_link_code="EDGE02",
            teacher_id=test_teacher.id,
        )
        db_session.add(task_list)
        await db_session.commit()
        await db_session.refresh(task_list)

        session = await create_student_session(
            task_list_id=task_list.id,
            nickname="BoundaryTest",
            db=db_session,
        )

        # Set to just before the expiry threshold (should still be valid)
        # Use a time that's slightly more recent than the expiry threshold
        boundary_time = datetime.now(timezone.utc) - timedelta(
            hours=STUDENT_SESSION_EXPIRE_HOURS
        ) + timedelta(seconds=1)
        session.last_activity_at = boundary_time
        await db_session.commit()

        result = await get_student_session(
            str(session.session_id), db=db_session, check_expiry=True
        )

        # Just before the boundary, session should still be valid (not expired)
        assert result is not None
