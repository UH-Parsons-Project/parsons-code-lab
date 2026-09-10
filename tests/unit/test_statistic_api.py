"""
Unit tests for statistic_api.py - Statistics API endpoints.
"""

import pytest
import pytest_asyncio
from datetime import datetime, timezone, timedelta
from fastapi import status
from sqlalchemy import select
from unittest.mock import patch, AsyncMock

from backend.models import (
    Student, TaskSet, Parsons, StudentTaskSetEnrollment,
    StudentTaskEnrollment, TaskAttempt, TaskSession, EditEvent, MoveEvent, ModelAnswer,
    Teacher, TaskSetItem, TaskSetViewer,
)
from backend.pydantic import StudentTaskAttemptResponse, StudentTaskStatisticsResponse
from backend.database import get_db
from backend.teacher_auth import create_access_token
from backend.main import app


def _auth(username: str) -> dict:
    """Return an Authorization header dict for the given teacher username."""
    return {"Authorization": f"Bearer {create_access_token({'sub': username})}"}


async def _create_shared_viewer(db_session, task_set_id: int) -> Teacher:
    viewer = Teacher(username="statsviewer", email="statsviewer@example.com", is_active=True)
    viewer.set_password("password123")
    db_session.add(viewer)
    await db_session.commit()
    await db_session.refresh(viewer)

    db_session.add(TaskSetViewer(task_set_id=task_set_id, teacher_id=viewer.id))
    await db_session.commit()
    return viewer


@pytest_asyncio.fixture
async def student_with_attempts(db_session, task_set, task) -> Student:
    """Create a student with task attempts for testing."""
    student = Student(username="attempt_student", email="attempt@example.com")
    student.set_password("password123")
    db_session.add(student)
    await db_session.flush()
    
    # Enroll student in task set and task
    enrollment = StudentTaskSetEnrollment(student_id=student.id, task_set_id=task_set.id)
    db_session.add(enrollment)
    await db_session.flush()
    
    task_enrollment = StudentTaskEnrollment(
        student_id=student.id,
        task_id=task.id,
        task_set_id=task_set.id,
        started_at=datetime(2026, 1, 1, 10, 0, 0)
    )
    db_session.add(task_enrollment)
    await db_session.flush()
    
    # Create task session
    session = TaskSession(
        student_task_enrollment_id=task_enrollment.id,
        entered_at=datetime(2026, 1, 1, 10, 0, 0),
        exited_at=datetime(2026, 1, 1, 10, 5, 0),
    )
    db_session.add(session)
    await db_session.flush()
    
    # Create a successful attempt
    attempt = TaskAttempt(
        student_id=student.id,
        task_id=task.id,
        student_task_enrollment_id=task_enrollment.id,
        task_session_id=session.id,
        completed_at=datetime(2026, 1, 1, 10, 5, 0),
        success=True,
        submitted_inputs={"code": "print('hello')"}
    )
    db_session.add(attempt)
    await db_session.commit()
    await db_session.refresh(student)
    
    return student


@pytest_asyncio.fixture
async def model_answer_for_task(db_session, task, test_teacher) -> ModelAnswer:
    """Create a model answer for a task."""
    model_answer = ModelAnswer(
        parsons_id=task.id,
        created_by_teacher_id=test_teacher.id,
        answer_code="print('correct solution')"
    )
    db_session.add(model_answer)
    await db_session.commit()
    await db_session.refresh(model_answer)
    return model_answer


class TestGetModelAnswerForTask:
    """Tests for _get_model_answer_for_task helper function."""

    @pytest.mark.asyncio
    async def test_get_model_answer_when_exists(self, db_session, task, model_answer_for_task):
        """Test retrieving a model answer when it exists."""
        from backend.routes.statistic.statistic_api import _get_model_answer_for_task
        
        result = await _get_model_answer_for_task(task, db_session)
        assert result == "print('correct solution')"

    async def test_get_model_answer_when_not_exists(self, db_session, task):
        """Test retrieving a model answer when it doesn't exist."""
        from backend.routes.statistic.statistic_api import _get_model_answer_for_task
        
        result = await _get_model_answer_for_task(task, db_session)
        assert result is None


class TestGetStudentAttempts:
    """Tests for GET /api/students/{student_username}/attempts endpoint."""

    async def test_get_student_attempts_success(self, client, db_session, test_teacher, 
                                                task_set, task, student_with_attempts):
        """Test successfully retrieving student attempts for a task set."""
        # Add task to task set
        from backend.models import TaskSetItem
        item = TaskSetItem(task_set_id=task_set.id, task_id=task.id)
        db_session.add(item)
        await db_session.commit()

        response = await client.get(
            f"/api/students/{student_with_attempts.id}/attempts?set_id={task_set.id}",
            headers=_auth(test_teacher.username)
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) > 0
        assert data[0]["task_title"] == task.title

    async def test_get_student_attempts_no_attempts(self, client, db_session, test_teacher, 
                                                     task_set, task, student_session):
        """Test retrieving attempts for student with no attempts."""
        from backend.models import TaskSetItem
        item = TaskSetItem(task_set_id=task_set.id, task_id=task.id)
        db_session.add(item)
        await db_session.commit()

        response = await client.get(
            f"/api/students/1/attempts?set_id={task_set.id}",
            headers=_auth(test_teacher.username)
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 1
        assert data[0]["attempts"] == 0
        assert data[0]["success_count"] == 0

    async def test_get_student_attempts_unauthorized(self, client, task_set, student_session):
        """Test that endpoint requires authentication."""
        response = await client.get(
            f"/api/students/1/attempts?set_id={task_set.id}"
        )
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    async def test_get_student_attempts_invalid_task_set(self, client, test_teacher):
        """Test with non-existent task set."""
        response = await client.get(
            f"/api/students/1/attempts?set_id=9999",
            headers=_auth(test_teacher.username)
        )
        assert response.status_code == status.HTTP_404_NOT_FOUND

    async def test_get_student_attempts_access_denied(self, client, db_session, 
                                                       test_teacher, task_set):
        """Test that teacher can't see attempts for task set they don't own."""
        # Create another teacher
        from backend.models import Teacher
        other_teacher = Teacher(username="otherteacher", email="other@example.com")
        other_teacher.set_password("password123")
        db_session.add(other_teacher)
        await db_session.commit()

        response = await client.get(
            f"/api/students/1/attempts?set_id={task_set.id}",
            headers=_auth(other_teacher.username)
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN

    async def test_get_student_attempts_shared_viewer_sees_private_task_in_shared_set(
        self, client, db_session, task_set, private_task, student_with_attempts
    ):
        item = TaskSetItem(task_set_id=task_set.id, task_id=private_task.id)
        db_session.add(item)

        task_enrollment = StudentTaskEnrollment(
            student_id=student_with_attempts.id,
            task_id=private_task.id,
            task_set_id=task_set.id,
            started_at=datetime(2026, 1, 1, 10, 0, 0),
        )
        db_session.add(task_enrollment)
        await db_session.flush()

        session = TaskSession(
            student_task_enrollment_id=task_enrollment.id,
            entered_at=datetime(2026, 1, 1, 10, 0, 0),
            exited_at=datetime(2026, 1, 1, 10, 5, 0),
        )
        db_session.add(session)
        await db_session.flush()

        db_session.add(TaskAttempt(
            student_id=student_with_attempts.id,
            task_id=private_task.id,
            student_task_enrollment_id=task_enrollment.id,
            task_session_id=session.id,
            completed_at=datetime(2026, 1, 1, 10, 5, 0),
            success=True,
            submitted_inputs={"code": "print('private')"},
        ))
        await db_session.commit()

        viewer = await _create_shared_viewer(db_session, task_set.id)

        response = await client.get(
            f"/api/students/{student_with_attempts.id}/attempts?set_id={task_set.id}",
            headers=_auth(viewer.username),
        )
        assert response.status_code == 200
        data = response.json()
        assert any(item["task_id"] == private_task.id for item in data)

class TestGetStudentTaskStatistics:
    """Tests for GET /api/students/{student_username}/tasks/{task_id}/statistics endpoint."""

    async def test_get_student_task_statistics_success(self, client, db_session, test_teacher,
                                                       task_set, task, student_with_attempts):
        """Test successfully retrieving student task statistics."""
        response = await client.get(
            f"/api/students/{student_with_attempts.id}/tasks/{task.id}/statistics?set_id={task_set.id}",
            headers=_auth(test_teacher.username)
        )
        assert response.status_code == 200
        data = response.json()
        assert data["student_username"] == "attempt_student"
        assert data["task_name"] == task.title
        assert data["total_attempts"] >= 0
        assert "successful_attempts" in data
        assert "failed_attempts" in data

    async def test_get_student_task_statistics_no_attempts(self, client, db_session, test_teacher,
                                                            task_set, task, student_session):
        """Test statistics for student with no attempts."""
        response = await client.get(
            f"/api/students/1/tasks/{task.id}/statistics?set_id={task_set.id}",
            headers=_auth(test_teacher.username)
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total_attempts"] == 0
        assert data["successful_attempts"] == 0
        assert data["failed_attempts"] == 0
        assert data["attempts_detail"] == []

    async def test_get_student_task_statistics_task_not_found(self, client, test_teacher, task_set):
        """Test with non-existent task."""
        response = await client.get(
            f"/api/students/1/tasks/9999/statistics?set_id={task_set.id}",
            headers=_auth(test_teacher.username)
        )
        assert response.status_code == status.HTTP_404_NOT_FOUND

    async def test_get_student_task_statistics_unauthorized(self, client, task_set, task):
        """Test that endpoint requires authentication."""
        response = await client.get(
            f"/api/students/1/tasks/{task.id}/statistics?set_id={task_set.id}"
        )
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    async def test_get_student_task_statistics_with_thinking_time(self, db_session, client, 
                                                                   test_teacher, task_set, task):
        """Test that thinking time is calculated correctly."""
        # Create student with enrollment and move event
        student = Student(username="thinking_student", email="think@example.com")
        student.set_password("password123")
        db_session.add(student)
        await db_session.flush()
        
        enrollment = StudentTaskSetEnrollment(student_id=student.id, task_set_id=task_set.id)
        db_session.add(enrollment)
        await db_session.flush()
        
        task_enrollment = StudentTaskEnrollment(
            student_id=student.id,
            task_id=task.id,
            task_set_id=task_set.id,
            started_at=datetime(2026, 1, 1, 10, 0, 0)
        )
        db_session.add(task_enrollment)
        await db_session.flush()
        
        session = TaskSession(
            student_task_enrollment_id=task_enrollment.id,
            entered_at=datetime(2026, 1, 1, 10, 0, 0),
            exited_at=datetime(2026, 1, 1, 10, 5, 0),
        )
        db_session.add(session)
        await db_session.flush()
        
        attempt = TaskAttempt(
            student_id=student.id,
            task_id=task.id,
            student_task_enrollment_id=task_enrollment.id,
            task_session_id=session.id,
            completed_at=datetime(2026, 1, 1, 10, 5, 0),
            success=True,
            submitted_inputs={"code": "test"}
        )
        db_session.add(attempt)
        await db_session.flush()
        
        # Add a move event 30 seconds after enrollment started
        move_event = MoveEvent(
            attempt_id=attempt.id,
            block_id="block_1",
            from_container="source",
            to_container="target",
            from_index=0,
            to_index=1,
            from_indent=0,
            to_indent=0,
            event_time=datetime(2026, 1, 1, 10, 0, 30)
        )
        db_session.add(move_event)
        await db_session.commit()
        
        response = await client.get(
            f"/api/students/{student.id}/tasks/{task.id}/statistics?set_id={task_set.id}",
            headers=_auth(test_teacher.username)
        )
        assert response.status_code == 200
        data = response.json()
        assert data["thinking_time"] is not None
        assert "seconds" in data["thinking_time"]
        assert data["thinking_time"]["seconds"] == 30

    async def test_get_student_task_statistics_with_empty_attempts(self, db_session, client,
                                                                    test_teacher, task_set, task):
        """Test filtering of empty attempts (attempts without custom code)."""
        student = Student(username="empty_student", email="empty@example.com")
        student.set_password("password123")
        db_session.add(student)
        await db_session.flush()
        
        enrollment = StudentTaskSetEnrollment(student_id=student.id, task_set_id=task_set.id)
        db_session.add(enrollment)
        await db_session.flush()
        
        task_enrollment = StudentTaskEnrollment(
            student_id=student.id,
            task_id=task.id,
            task_set_id=task_set.id,
            started_at=datetime(2026, 1, 1, 10, 0, 0)
        )
        db_session.add(task_enrollment)
        await db_session.flush()
        
        session = TaskSession(
            student_task_enrollment_id=task_enrollment.id,
            entered_at=datetime(2026, 1, 1, 10, 0, 0),
            exited_at=datetime(2026, 1, 1, 10, 5, 0),
        )
        db_session.add(session)
        await db_session.flush()
        
        # Create attempt with empty code (empty attempts are filtered out)
        attempt = TaskAttempt(
            student_id=student.id,
            task_id=task.id,
            student_task_enrollment_id=task_enrollment.id,
            task_session_id=session.id,
            completed_at=datetime(2026, 1, 1, 10, 5, 0),
            success=False,
            submitted_inputs={"code": ""}
        )
        db_session.add(attempt)
        await db_session.commit()
        
        response = await client.get(
            f"/api/students/{student.id}/tasks/{task.id}/statistics?set_id={task_set.id}",
            headers=_auth(test_teacher.username)
        )
        assert response.status_code == 200
        data = response.json()
        assert data["empty_attempts"] == 0
        assert data["total_attempts"] == 1

    async def test_get_student_task_statistics_multiple_sessions(self, db_session, client,
                                                                  test_teacher, task_set, task):
        """Test statistics with multiple sessions."""
        student = Student(username="session_student", email="session@example.com")
        student.set_password("password123")
        db_session.add(student)
        await db_session.flush()
        
        enrollment = StudentTaskSetEnrollment(student_id=student.id, task_set_id=task_set.id)
        db_session.add(enrollment)
        await db_session.flush()
        
        task_enrollment = StudentTaskEnrollment(
            student_id=student.id,
            task_id=task.id,
            task_set_id=task_set.id,
            started_at=datetime(2026, 1, 1, 10, 0, 0)
        )
        db_session.add(task_enrollment)
        await db_session.flush()
        
        # Create first session
        session1 = TaskSession(
            student_task_enrollment_id=task_enrollment.id,
            entered_at=datetime(2026, 1, 1, 10, 0, 0),
            exited_at=datetime(2026, 1, 1, 10, 5, 0),
        )
        db_session.add(session1)
        await db_session.flush()
        
        # Create second session
        session2 = TaskSession(
            student_task_enrollment_id=task_enrollment.id,
            entered_at=datetime(2026, 1, 1, 10, 10, 0),
            exited_at=datetime(2026, 1, 1, 10, 15, 0),
        )
        db_session.add(session2)
        await db_session.flush()
        
        attempt = TaskAttempt(
            student_id=student.id,
            task_id=task.id,
            student_task_enrollment_id=task_enrollment.id,
            task_session_id=session2.id,
            completed_at=datetime(2026, 1, 1, 10, 15, 0),
            success=True,
            submitted_inputs={"code": "test"}
        )
        db_session.add(attempt)
        await db_session.commit()
        
        response = await client.get(
            f"/api/students/{student.id}/tasks/{task.id}/statistics?set_id={task_set.id}",
            headers=_auth(test_teacher.username)
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total_time_seconds"] is not None
        # Should be 5 + 5 = 10 minutes = 600 seconds
        assert data["total_time_seconds"] == 600
        assert len(data["sessions"]) == 2

    async def test_get_student_task_statistics_shared_viewer_can_access_private_task(
        self, client, db_session, task_set, private_task, student_session
    ):
        db_session.add(TaskSetItem(task_set_id=task_set.id, task_id=private_task.id))
        await db_session.flush()

        task_enrollment = StudentTaskEnrollment(
            student_id=student_session.id,
            task_id=private_task.id,
            task_set_id=task_set.id,
            started_at=datetime(2026, 1, 1, 10, 0, 0),
        )
        db_session.add(task_enrollment)
        await db_session.flush()

        session = TaskSession(
            student_task_enrollment_id=task_enrollment.id,
            entered_at=datetime(2026, 1, 1, 10, 0, 0),
            exited_at=datetime(2026, 1, 1, 10, 5, 0),
        )
        db_session.add(session)
        await db_session.flush()

        db_session.add(TaskAttempt(
            student_id=student_session.id,
            task_id=private_task.id,
            student_task_enrollment_id=task_enrollment.id,
            task_session_id=session.id,
            completed_at=datetime(2026, 1, 1, 10, 5, 0),
            success=True,
            submitted_inputs={"code": "print('private')"},
        ))
        await db_session.commit()

        viewer = await _create_shared_viewer(db_session, task_set.id)

        response = await client.get(
            f"/api/students/{student_session.id}/tasks/{private_task.id}/statistics?set_id={task_set.id}",
            headers=_auth(viewer.username),
        )
        assert response.status_code == 200
        data = response.json()
        assert data["task_name"] == private_task.title

@pytest.mark.asyncio
class TestStatisticAPIIntegration:
    """Integration tests for statistic API endpoints."""

    async def test_complete_workflow(self, client, db_session, test_teacher, task_set, task,
                                     student_session):
        """Test a complete workflow of statistics retrieval."""
        from backend.models import TaskSetItem
        item = TaskSetItem(task_set_id=task_set.id, task_id=task.id)
        db_session.add(item)
        await db_session.commit()

        # Get student attempts (should be empty)
        response = await client.get(
            f"/api/students/1/attempts?set_id={task_set.id}",
            headers=_auth(test_teacher.username)
        )
        assert response.status_code == 200
        attempts_data = response.json()
        assert len(attempts_data) == 1
        assert attempts_data[0]["attempts"] == 0

        # Add an attempt
        task_enrollment = StudentTaskEnrollment(
            student_id=student_session.id,
            task_id=task.id,
            task_set_id=task_set.id,
            started_at=datetime(2026, 1, 1, 10, 0, 0)
        )
        db_session.add(task_enrollment)
        await db_session.flush()

        session = TaskSession(
            student_task_enrollment_id=task_enrollment.id,
            entered_at=datetime(2026, 1, 1, 10, 0, 0),
            exited_at=datetime(2026, 1, 1, 10, 5, 0),
        )
        db_session.add(session)
        await db_session.flush()

        attempt = TaskAttempt(
            student_id=student_session.id,
            task_id=task.id,
            student_task_enrollment_id=task_enrollment.id,
            task_session_id=session.id,
            completed_at=datetime(2026, 1, 1, 10, 5, 0),
            success=True,
            submitted_inputs={"code": "correct"}
        )
        db_session.add(attempt)
        await db_session.commit()

        # Now get student attempts (should have one)
        response = await client.get(
            f"/api/students/1/attempts?set_id={task_set.id}",
            headers=_auth(test_teacher.username)
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["success_count"] == 1

        # Get student task statistics
        response = await client.get(
            f"/api/students/1/tasks/{task.id}/statistics?set_id={task_set.id}",
            headers=_auth(test_teacher.username)
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total_attempts"] == 1
        assert data["successful_attempts"] == 1

        # Get task statistics
        response = await client.get(
            f"/api/tasks/{task.id}/statistics?task_set_code={task_set.unique_link_code}",
            headers=_auth(test_teacher.username)
        )
        assert response.status_code == 200
        data = response.json()
        assert data["students_attempted"] == 1
        assert data["students_completed"] == 1

    async def test_student_task_stats_with_null_submitted_inputs(self, client, db_session,
                                                                  test_teacher, task_set, task):
        """Test task statistics when attempt has null submitted_inputs."""
        student = Student(username="null_inputs_student", email="null@example.com")
        student.set_password("password123")
        db_session.add(student)
        await db_session.flush()
        
        enrollment = StudentTaskSetEnrollment(student_id=student.id, task_set_id=task_set.id)
        db_session.add(enrollment)
        await db_session.flush()
        
        task_enrollment = StudentTaskEnrollment(
            student_id=student.id,
            task_id=task.id,
            task_set_id=task_set.id,
            started_at=datetime(2026, 1, 1, 10, 0, 0)
        )
        db_session.add(task_enrollment)
        await db_session.flush()
        
        session = TaskSession(
            student_task_enrollment_id=task_enrollment.id,
            entered_at=datetime(2026, 1, 1, 10, 0, 0),
            exited_at=datetime(2026, 1, 1, 10, 5, 0),
        )
        db_session.add(session)
        await db_session.flush()
        
        # Attempt with null submitted_inputs
        attempt = TaskAttempt(
            student_id=student.id,
            task_id=task.id,
            student_task_enrollment_id=task_enrollment.id,
            task_session_id=session.id,
            completed_at=datetime(2026, 1, 1, 10, 5, 0),
            success=True,
            submitted_inputs=None
        )
        db_session.add(attempt)
        await db_session.commit()
        
        response = await client.get(
            f"/api/students/{student.id}/tasks/{task.id}/statistics?set_id={task_set.id}",
            headers=_auth(test_teacher.username)
        )
        assert response.status_code == 200
        data = response.json()
        # Should still count the attempt
        assert data["total_attempts"] == 1

    async def test_get_task_statistics_without_task_set_filter(self, client, db_session,
                                                               test_teacher, task):
        """Test getting task statistics without task set filter."""
        response = await client.get(
            f"/api/tasks/{task.id}/statistics",
            headers=_auth(test_teacher.username)
        )
        assert response.status_code == 200
        data = response.json()
        assert "task_name" in data
        assert data["students_not_started"] == 0

    async def test_get_student_task_statistics_without_model_answer(self, client, db_session,
                                                                     test_teacher, task_set, task,
                                                                     student_with_attempts):
        """Test task statistics when no model answer exists."""
        response = await client.get(
            f"/api/students/{student_with_attempts.id}/tasks/{task.id}/statistics?set_id={task_set.id}",
            headers=_auth(test_teacher.username)
        )
        assert response.status_code == 200
        data = response.json()
        assert data["model_answer"] is None

    async def test_get_statistics_on_page_vs_wall_clock(self, db_session, client,
                                                        test_teacher, task_set, task):
        """Test detailed calculation of wall-clock vs on-page metrics and exits."""
        student = Student(username="new_analytics_student", email="analytics@example.com")
        student.set_password("password123")
        db_session.add(student)
        await db_session.flush()

        enrollment = StudentTaskSetEnrollment(student_id=student.id, task_set_id=task_set.id)
        db_session.add(enrollment)
        await db_session.flush()

        task_enrollment = StudentTaskEnrollment(
            student_id=student.id,
            task_id=task.id,
            task_set_id=task_set.id,
            started_at=datetime(2026, 1, 1, 10, 0, 0, tzinfo=timezone.utc)
        )
        db_session.add(task_enrollment)
        await db_session.flush()

        # Session 1: 10:00:00 to 10:01:00 (60s)
        session1 = TaskSession(
            student_task_enrollment_id=task_enrollment.id,
            entered_at=datetime(2026, 1, 1, 10, 0, 0, tzinfo=timezone.utc),
            exited_at=datetime(2026, 1, 1, 10, 1, 0, tzinfo=timezone.utc),
        )
        # Session 2: 10:02:00 to 10:03:00 (60s)
        session2 = TaskSession(
            student_task_enrollment_id=task_enrollment.id,
            entered_at=datetime(2026, 1, 1, 10, 2, 0, tzinfo=timezone.utc),
            exited_at=datetime(2026, 1, 1, 10, 3, 0, tzinfo=timezone.utc),
        )
        db_session.add(session1)
        db_session.add(session2)
        await db_session.flush()

        # Attempt 1 (Fail) at 10:02:40
        attempt1 = TaskAttempt(
            student_id=student.id,
            task_id=task.id,
            student_task_enrollment_id=task_enrollment.id,
            task_session_id=session2.id,
            completed_at=datetime(2026, 1, 1, 10, 2, 40, tzinfo=timezone.utc),
            success=False,
            submitted_inputs={"code": "test fail"}
        )
        # Attempt 2 (Success) at 10:03:00
        attempt2 = TaskAttempt(
            student_id=student.id,
            task_id=task.id,
            student_task_enrollment_id=task_enrollment.id,
            task_session_id=session2.id,
            completed_at=datetime(2026, 1, 1, 10, 3, 0, tzinfo=timezone.utc),
            success=True,
            submitted_inputs={"code": "test success"}
        )
        db_session.add(attempt1)
        db_session.add(attempt2)
        await db_session.flush()

        # First move event at 10:02:30 (first action time)
        move_event = MoveEvent(
            attempt_id=attempt1.id,
            block_id="block_1",
            from_container="source",
            to_container="target",
            from_index=0,
            to_index=1,
            from_indent=0,
            to_indent=0,
            event_time=datetime(2026, 1, 1, 10, 2, 30, tzinfo=timezone.utc)
        )
        db_session.add(move_event)
        await db_session.commit()

        # Request student-specific endpoint
        response = await client.get(
            f"/api/students/{student.id}/tasks/{task.id}/statistics?set_id={task_set.id}",
            headers=_auth(test_teacher.username)
        )
        assert response.status_code == 200
        data = response.json()

        # Thinking time: wall-clock is 150s, on-page is 90s
        assert data["thinking_time"]["seconds"] == 150.0
        assert data["thinking_time_on_page"]["seconds"] == 90.0

        # Success time: wall-clock is 180s, on-page is 120s
        assert data["time_to_first_success"]["seconds"] == 180.0
        assert data["time_to_first_success_on_page"]["seconds"] == 120.0

        # Fail time: wall-clock is 160s, on-page is 100s
        assert data["time_to_first_fail"]["seconds"] == 160.0
        assert data["time_to_first_fail_on_page"]["seconds"] == 100.0

        # Exits: student has 2 sessions, so 1 exit
        assert data["median_page_exits"] == 1.0

        # Request aggregate task statistics endpoint
        agg_response = await client.get(
            f"/api/tasks/{task.id}/statistics?task_set_code={task_set.unique_link_code}",
            headers=_auth(test_teacher.username)
        )
        assert agg_response.status_code == 200
        agg_data = agg_response.json()
        assert agg_data["thinking_time"]["median"] == 150.0
        assert agg_data["thinking_time_on_page"]["median"] == 90.0
        assert agg_data["time_to_first_success"]["median"] == 180.0
        assert agg_data["time_to_first_success_on_page"]["median"] == 120.0
        assert agg_data["time_to_first_fail"]["median"] == 160.0
        assert agg_data["time_to_first_fail_on_page"]["median"] == 100.0
        assert agg_data["median_page_exits"] == 1.0
        assert agg_data["min_page_exits"] == 1
        assert agg_data["max_page_exits"] == 1
        assert agg_data["avg_page_exits"] == 1.0

