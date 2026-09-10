"""
Unit tests for student_api.py - Student API endpoints.
"""

import pytest
from datetime import datetime, timezone
from fastapi import status
from sqlalchemy import select
from unittest.mock import patch, AsyncMock

from backend.models import (
    Student, TaskSet, Parsons, StudentTaskSetEnrollment, 
    StudentTaskEnrollment, TaskAttempt, TaskSession
)
from backend.pydantic import SubmitTestResultRequest, RecordExitRequest, MoveData, EditEventData
from backend.database import get_db
from backend.student_auth import get_current_student_session_no_update
from backend.main import app


class TestStudentMe:
    """Tests for GET /api/student/me endpoint."""

    async def test_get_student_me_when_logged_in(self, client, db_session, task_set):
        """Test retrieving logged-in student info."""
        # Create and login a student
        student = Student(username="teststu", email="test@example.com")
        student.set_password("password123")
        db_session.add(student)
        await db_session.commit()
        await db_session.refresh(student)

        # Login
        login_response = await client.post(
            "/api/student_login",
            json={
                "email": "test@example.com",
                "password": "password123",
                "unique_link_code": "NOTREAL",
            }
        )
        assert login_response.status_code == 200

        # Get student info
        response = await client.get("/api/student/me")
        assert response.status_code == 200
        data = response.json()
        assert data["username"] == "teststu"

    async def test_get_student_me_when_not_logged_in(self, client):
        """Test that /api/student/me returns 401 when not logged in."""
        response = await client.get("/api/student/me")
        assert response.status_code == status.HTTP_401_UNAUTHORIZED


class TestJoinTaskSet:
    """Tests for POST /api/sets/{unique_link_code}/join endpoint."""

    async def test_join_task_set_success(self, client, db_session, task_set, student_session):
        """Test successfully joining a task set."""
        # Login student
        login_response = await client.post(
            "/api/student_login",
            json={
                "email": student_session.email,
                "password": "studentpass123",
                "unique_link_code": task_set.unique_link_code,
            }
        )
        assert login_response.status_code == 200

        # Join the task set
        response = await client.post(
            f"/api/sets/{task_set.unique_link_code}/join"
        )
        assert response.status_code == 200
        assert response.json()["status"] == "enrolled"

    async def test_join_task_set_not_logged_in(self, client, task_set):
        """Test joining task set without being logged in."""
        response = await client.post(
            f"/api/sets/{task_set.unique_link_code}/join"
        )
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    async def test_join_nonexistent_task_set(self, client, db_session, student_session):
        """Test joining a task set that doesn't exist."""
        # Login student
        login_response = await client.post(
            "/api/student_login",
            json={
                "email": student_session.email,
                "password": "studentpass123",
            }
        )
        assert login_response.status_code == 200

        # Try to join non-existent task set
        response = await client.post(
            f"/api/sets/NONEXISTENT/join"
        )
        assert response.status_code == 404


class TestCheckEnrollment:
    """Tests for GET /api/sets/{unique_link_code}/is-enrolled endpoint."""

    async def test_check_enrollment_when_enrolled(self, client, db_session, task_set, student_session):
        """Test checking enrollment when student is enrolled."""
        # Login student
        login_response = await client.post(
            "/api/student_login",
            json={
                "email": student_session.email,
                "password": "studentpass123",
                "unique_link_code": task_set.unique_link_code,
            }
        )
        assert login_response.status_code == 200

        # Check enrollment
        response = await client.get(
            f"/api/sets/{task_set.unique_link_code}/is-enrolled"
        )
        assert response.status_code == 200
        assert response.json()["enrolled"] is True

    async def test_check_enrollment_when_not_enrolled(self, client, db_session, task_set):
        """Test checking enrollment when not enrolled."""
        response = await client.get(
            f"/api/sets/{task_set.unique_link_code}/is-enrolled"
        )
        assert response.status_code == 200
        assert response.json()["enrolled"] is False

    async def test_check_enrollment_nonexistent_task_set(self, client):
        """Test checking enrollment for non-existent task set."""
        response = await client.get(
            "/api/sets/NONEXISTENT/is-enrolled"
        )
        assert response.status_code == 200
        assert response.json()["enrolled"] is False


class TestStudentLogin:
    """Tests for POST /api/student_login endpoint."""

    async def test_student_login_success(self, client, db_session):
        """Test successful student login."""
        student = Student(username="logintest", email="login@example.com")
        student.set_password("password123")
        db_session.add(student)
        await db_session.commit()

        response = await client.post(
            "/api/student_login",
            json={
                "email": "login@example.com",
                "password": "password123",
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert data["username"] == "logintest"
        assert "student_id" in data

    async def test_student_login_wrong_password(self, client, db_session):
        """Test student login with wrong password."""
        student = Student(username="wrongpass", email="wrong@example.com")
        student.set_password("correctpassword")
        db_session.add(student)
        await db_session.commit()

        response = await client.post(
            "/api/student_login",
            json={
                "email": "wrong@example.com",
                "password": "incorrectpassword",
            }
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "Incorrect" in response.json()["detail"]

    async def test_student_login_missing_credentials(self, client):
        """Test student login with missing credentials."""
        response = await client.post(
            "/api/student_login",
            json={"email": "test"}
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    async def test_student_login_with_task_set_enrollment(self, client, db_session, task_set):
        """Test student login with automatic task set enrollment."""
        student = Student(username="enrolltest", email="enroll@example.com")
        student.set_password("password123")
        db_session.add(student)
        await db_session.commit()

        response = await client.post(
            "/api/student_login",
            json={
                "email": "enroll@example.com",
                "password": "password123",
                "unique_link_code": task_set.unique_link_code,
            }
        )
        assert response.status_code == 200

        # Verify enrollment was created
        stmt = select(StudentTaskSetEnrollment).where(
            StudentTaskSetEnrollment.task_set_id == task_set.id
        )
        result = await db_session.execute(stmt)
        enrollment = result.scalar_one_or_none()
        assert enrollment is not None


class TestStudentLogout:
    """Tests for POST /api/student_logout endpoint."""

    async def test_student_logout_success(self, client, db_session, student_session):
        """Test successful student logout."""
        # Login first
        login_response = await client.post(
            "/api/student_login",
            json={
                "email": student_session.email,
                "password": "studentpass123",
            }
        )
        assert login_response.status_code == 200

        # Logout
        response = await client.post("/api/student_logout")
        assert response.status_code == 200
        assert "Successfully logged out" in response.json()["message"]

    async def test_student_logout_no_session(self, client):
        """Test logout when not logged in."""
        response = await client.post("/api/student_logout")
        assert response.status_code == 200


class TestStudentRegister:
    """Tests for POST /api/student_register endpoint."""

    async def test_student_register_success(self, client, db_session):
        """Test successful student registration."""
        response = await client.post(
            "/api/student_register",
            json={
                "username": "newstudent",
                "email": "new@example.com",
                "password": "password123",
                "password_confirm": "password123",
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert "id" in data

    async def test_student_register_duplicate_email(self, client, db_session):
        """Test registration with duplicate email."""
        student = Student(username="first", email="duplicate@example.com")
        student.set_password("password123")
        db_session.add(student)
        await db_session.commit()

        response = await client.post(
            "/api/student_register",
            json={
                "username": "second",
                "email": "duplicate@example.com",
                "password": "password123",
                "password_confirm": "password123",
            }
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    async def test_student_register_password_mismatch(self, client):
        """Test registration with password mismatch."""
        response = await client.post(
            "/api/student_register",
            json={
                "username": "newuser",
                "email": "user@example.com",
                "password": "password123",
                "password_confirm": "differentpassword",
            }
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    async def test_student_register_username_too_long(self, client):
        """Test registration with username exceeding max length."""
        response = await client.post(
            "/api/student_register",
            json={
                "username": "a" * 21,
                "email": "user@example.com",
                "password": "password123",
                "password_confirm": "password123",
            }
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST


class TestGetTaskForStudent:
    """Tests for GET /api/sets/{unique_link_code}/tasks/{task_id} endpoint."""

    async def test_get_task_for_student_success(self, client, db_session, task_set_with_task, student_session):
        """Test retrieving task for student."""
        task_set, task = task_set_with_task

        # Login student
        login_response = await client.post(
            "/api/student_login",
            json={
                "email": student_session.email,
                "password": "studentpass123",
                "unique_link_code": task_set.unique_link_code,
            }
        )
        assert login_response.status_code == 200

        # Get task
        response = await client.get(
            f"/api/sets/{task_set.unique_link_code}/tasks/{task.id}"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == task.id
        assert data["title"] == task.title
        assert "correct_solution" in data
        assert "solution_code" not in data["correct_solution"]
        assert "correct_order" not in data["correct_solution"]
        assert "solution" not in data["correct_solution"]

    async def test_get_task_for_student_includes_teacher_tests(self, client, db_session, task_set_with_task, student_session):
        """Test that teacher_tests in correct_solution are delivered to student."""
        task_set, task = task_set_with_task
        task.correct_solution = {
            "solution_code": "def foo(): pass",
            "correct_order": ["block_1"],
            "teacher_tests": ">>> foo()\n",
            "custom_error_messages": "error rule",
        }
        await db_session.commit()

        login_response = await client.post(
            "/api/student_login",
            json={
                "email": student_session.email,
                "password": "studentpass123",
                "unique_link_code": task_set.unique_link_code,
            }
        )
        assert login_response.status_code == 200

        response = await client.get(
            f"/api/sets/{task_set.unique_link_code}/tasks/{task.id}"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["correct_solution"]["teacher_tests"] == ">>> foo()\n"
        assert data["correct_solution"]["custom_error_messages"] == "error rule"
        assert "solution_code" not in data["correct_solution"]
        assert "correct_order" not in data["correct_solution"]

    async def test_get_task_not_logged_in(self, client, task_set_with_task):
        """Test getting task without being logged in."""
        task_set, task = task_set_with_task

        response = await client.get(
            f"/api/sets/{task_set.unique_link_code}/tasks/1"
        )
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    async def test_get_task_nonexistent_task_set(self, client, db_session, student_session):
        """Test getting task from non-existent task set."""
        # Login student
        login_response = await client.post(
            "/api/student_login",
            json={
                "email": student_session.email,
                "password": "studentpass123",
            }
        )
        assert login_response.status_code == 200

        response = await client.get(
            "/api/sets/NONEXISTENT/tasks/1"
        )
        assert response.status_code == 404


class TestCheckTaskHasStarted:
    """Tests for GET /api/sets/{unique_link_code}/tasks/{task_id}/has-started endpoint."""

    async def test_check_task_started_when_started(self, client, db_session, task_set_with_task, student_session):
        """Test checking if task has started when it has."""
        task_set, task = task_set_with_task

        # Login student
        login_response = await client.post(
            "/api/student_login",
            json={
                "email": student_session.email,
                "password": "studentpass123",
                "unique_link_code": task_set.unique_link_code,
            }
        )
        assert login_response.status_code == 200

        # Create enrollment
        enrollment = StudentTaskEnrollment(
            student_id=student_session.id,
            task_id=task.id,
            task_set_id=task_set.id
        )
        db_session.add(enrollment)
        await db_session.commit()

        # Check if started
        response = await client.get(
            f"/api/sets/{task_set.unique_link_code}/tasks/{task.id}/has-started"
        )
        assert response.status_code == 200
        assert response.json()["has_started"] is True

    async def test_check_task_started_when_not_started(self, client, db_session, task_set_with_task, student_session):
        """Test checking if task has started when it hasn't."""
        task_set, task = task_set_with_task

        # Login student
        login_response = await client.post(
            "/api/student_login",
            json={
                "email": student_session.email,
                "password": "studentpass123",
                "unique_link_code": task_set.unique_link_code,
            }
        )
        assert login_response.status_code == 200

        # Check if started (without creating enrollment)
        response = await client.get(
            f"/api/sets/{task_set.unique_link_code}/tasks/{task.id}/has-started"
        )
        assert response.status_code == 200
        assert response.json()["has_started"] is False

    async def test_check_task_started_not_logged_in(self, client, task_set_with_task):
        """Test checking task started without being logged in."""
        task_set, task = task_set_with_task

        response = await client.get(
            f"/api/sets/{task_set.unique_link_code}/tasks/1/has-started"
        )
        assert response.status_code == 200
        assert response.json()["has_started"] is False


class TestGetCompletionStatus:
    """Tests for GET /api/sets/{unique_link_code}/tasks/{task_id}/my-completion-status endpoint."""

    async def test_get_completion_status_no_attempts(self, client, db_session, task_set_with_task, student_session):
        """Test getting completion status with no attempts."""
        task_set, task = task_set_with_task

        # Login student
        login_response = await client.post(
            "/api/student_login",
            json={
                "email": student_session.email,
                "password": "studentpass123",
                "unique_link_code": task_set.unique_link_code,
            }
        )
        assert login_response.status_code == 200

        # Get completion status
        response = await client.get(
            f"/api/sets/{task_set.unique_link_code}/tasks/{task.id}/my-completion-status"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["student_attempts"] == 0
        assert data["student_completed"] == 0

    async def test_get_completion_status_with_failed_attempt(self, client, db_session, task_set_with_task, student_session):
        """Test getting completion status with failed attempt."""
        task_set, task = task_set_with_task

        # Login student
        login_response = await client.post(
            "/api/student_login",
            json={
                "email": student_session.email,
                "password": "studentpass123",
                "unique_link_code": task_set.unique_link_code,
            }
        )
        assert login_response.status_code == 200

        # Create enrollment and attempt
        enrollment = StudentTaskEnrollment(
            student_id=student_session.id,
            task_id=task.id,
            task_set_id=task_set.id
        )
        db_session.add(enrollment)
        await db_session.flush()

        attempt = TaskAttempt(
            student_id=student_session.id,
            task_id=task.id,
            student_task_enrollment_id=enrollment.id,
            success=False
        )
        db_session.add(attempt)
        await db_session.commit()

        # Get completion status
        response = await client.get(
            f"/api/sets/{task_set.unique_link_code}/tasks/{task.id}/my-completion-status"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["student_attempts"] == 1
        assert data["student_completed"] == 0

    async def test_get_completion_status_with_successful_attempt(self, client, db_session, task_set_with_task, student_session):
        """Test getting completion status with successful attempt."""
        task_set, task = task_set_with_task

        # Login student
        login_response = await client.post(
            "/api/student_login",
            json={
                "email": student_session.email,
                "password": "studentpass123",
                "unique_link_code": task_set.unique_link_code,
            }
        )
        assert login_response.status_code == 200

        # Create enrollment and successful attempt
        enrollment = StudentTaskEnrollment(
            student_id=student_session.id,
            task_id=task.id,
            task_set_id=task_set.id
        )
        db_session.add(enrollment)
        await db_session.flush()

        attempt = TaskAttempt(
            student_id=student_session.id,
            task_id=task.id,
            student_task_enrollment_id=enrollment.id,
            success=True
        )
        db_session.add(attempt)
        await db_session.commit()

        # Get completion status
        response = await client.get(
            f"/api/sets/{task_set.unique_link_code}/tasks/{task.id}/my-completion-status"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["student_attempts"] == 1
        assert data["student_completed"] == 1


class TestStartTask:
    """Tests for POST /api/sets/{unique_link_code}/tasks/{task_id}/start endpoint."""

    async def test_start_task_success(self, client, db_session, task_set_with_task, student_session):
        """Test successfully starting a task."""
        task_set, task = task_set_with_task

        # Login student
        login_response = await client.post(
            "/api/student_login",
            json={
                "email": student_session.email,
                "password": "studentpass123",
                "unique_link_code": task_set.unique_link_code,
            }
        )
        assert login_response.status_code == 200

        # Start task
        response = await client.post(
            f"/api/sets/{task_set.unique_link_code}/tasks/{task.id}/start"
        )
        assert response.status_code == 200
        data = response.json()
        assert "started_at" in data
        assert "session_id" in data
        assert "entered_at" in data

    async def test_start_task_not_logged_in(self, client, task_set_with_task):
        """Test starting task without being logged in."""
        task_set, task = task_set_with_task

        response = await client.post(
            f"/api/sets/{task_set.unique_link_code}/tasks/1/start"
        )
        assert response.status_code == status.HTTP_401_UNAUTHORIZED


class TestSubmitTestResult:
    """Tests for POST /api/sets/{unique_link_code}/tasks/{task_id}/submit-result endpoint."""

    async def test_submit_test_result_not_logged_in(self, client, task_set_with_task):
        """Test submitting result without being logged in."""
        task_set, task = task_set_with_task

        response = await client.post(
            f"/api/sets/{task_set.unique_link_code}/tasks/1/submit-result",
            json={
                "task_id": task.id,
                "success": True,
                "submitted_code": "print('hello')",
                "test_output": "hello",
                "repr_code": "print('hello')",
                "moves": [],
                "edits": [],
            }
        )
        assert response.status_code == status.HTTP_401_UNAUTHORIZED


class TestEnterTask:
    """Tests for POST /api/sets/{unique_link_code}/tasks/{task_id}/enter endpoint."""

    async def test_enter_task_not_logged_in(self, client, task_set_with_task):
        """Test entering task without being logged in."""
        task_set, task = task_set_with_task

        response = await client.post(
            f"/api/sets/{task_set.unique_link_code}/tasks/1/enter"
        )
        assert response.status_code == status.HTTP_401_UNAUTHORIZED


class TestRecordTaskExit:
    """Tests for POST /api/sets/{unique_link_code}/tasks/{task_id}/record-exit endpoint."""

    async def test_record_task_exit_not_logged_in(self, client, task_set_with_task):
        """Test recording exit without being logged in."""
        task_set, task = task_set_with_task

        response = await client.post(
            f"/api/sets/{task_set.unique_link_code}/tasks/1/record-exit",
            json={
                "session_id": 1,
                "exited_at": datetime.now(timezone.utc).isoformat(),
                "exit_reason": "completed",
            }
        )
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    async def test_record_task_exit_invalid_session(self, client, db_session, task_set_with_task, student_session):
        """Test recording exit with invalid session ID."""
        task_set, task = task_set_with_task

        # Use dependency override to simulate logged-in student
        app.dependency_overrides[get_current_student_session_no_update] = lambda: student_session

        # Try to record exit with non-existent session
        response = await client.post(
            f"/api/sets/{task_set.unique_link_code}/tasks/{task.id}/record-exit",
            json={
                "session_id": 99999,
                "exited_at": datetime.now(timezone.utc).isoformat(),
                "exit_reason": "completed",
            }
        )
        app.dependency_overrides.clear()
        assert response.status_code == 404