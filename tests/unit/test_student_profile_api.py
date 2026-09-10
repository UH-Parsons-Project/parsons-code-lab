"""
Unit tests for student profile and credentials update API endpoints.
"""

import pytest
from fastapi import status
from sqlalchemy import select

from backend.models import (
    Student, TaskSet, Parsons, StudentTaskSetEnrollment,
    StudentTaskEnrollment, TaskAttempt, TaskSetItem, Teacher
)

@pytest.mark.asyncio
class TestStudentProfileApi:
    """Tests for student profile and change credentials endpoints."""

    async def test_get_profile_unauthorized(self, client):
        """Test that get profile returns 401 when student is not logged in."""
        resp = await client.get("/api/student/profile")
        assert resp.status_code == status.HTTP_401_UNAUTHORIZED

    async def test_get_profile_authorized(self, client, db_session, test_teacher, task):
        """Test retrieving logged-in student profile with the task set list."""
        # 1. Create a task set and add the task
        task_set = TaskSet(
            teacher_id=test_teacher.id,
            title="Profile Test Set",
            unique_link_code="PROFILECODE"
        )
        db_session.add(task_set)
        await db_session.commit()
        await db_session.refresh(task_set)

        task_set_item = TaskSetItem(task_set_id=task_set.id, task_id=task.id)
        db_session.add(task_set_item)
        await db_session.commit()

        # 2. Create student
        student = Student(username="profilestu", email="profile@example.com")
        student.set_password("studentpass123")
        db_session.add(student)
        await db_session.commit()
        await db_session.refresh(student)

        # 3. Log student in and join task set
        login_resp = await client.post(
            "/api/student_login",
            json={
                "email": "profile@example.com",
                "password": "studentpass123",
                "unique_link_code": "PROFILECODE"
            }
        )
        assert login_resp.status_code == 200

        enrollment_stmt = select(StudentTaskSetEnrollment).where(
            StudentTaskSetEnrollment.student_id == student.id,
            StudentTaskSetEnrollment.task_set_id == task_set.id,
        )
        enrollment_result = await db_session.execute(enrollment_stmt)
        task_set_enrollment = enrollment_result.scalar_one()

        # 4. Enroll student in the task & record a successful attempt
        enrollment = StudentTaskEnrollment(
            student_id=student.id,
            task_id=task.id,
            task_set_id=task_set.id
        )
        db_session.add(enrollment)
        await db_session.commit()
        await db_session.refresh(enrollment)

        attempt = TaskAttempt(
            student_id=student.id,
            task_id=task.id,
            student_task_enrollment_id=enrollment.id,
            success=True
        )
        db_session.add(attempt)
        await db_session.commit()

        # 5. Fetch profile API
        profile_resp = await client.get("/api/student/profile")
        assert profile_resp.status_code == 200
        
        data = profile_resp.json()
        assert data["username"] == "profilestu"
        assert data["email"] == "profile@example.com"
        assert data["joined_task_sets"] == [
            {
                "id": task_set.id,
                "title": "Profile Test Set",
                "unique_link_code": "PROFILECODE",
                "teacher_username": test_teacher.username,
                "enrolled_at": task_set_enrollment.enrolled_at.isoformat(),
                "task_count": 1,
                "completed_tasks": 1,
                "is_completed": True,
            }
        ]

    async def test_get_profile_authorized_without_joined_sets(self, client, db_session):
        """Test retrieving a profile when the student has not joined any task sets."""
        student = Student(username="lonestu", email="lone@example.com")
        student.set_password("studentpass123")
        db_session.add(student)
        await db_session.commit()

        await client.post(
            "/api/student_login",
            json={"email": "lone@example.com", "password": "studentpass123"}
        )

        profile_resp = await client.get("/api/student/profile")
        assert profile_resp.status_code == status.HTTP_200_OK

        data = profile_resp.json()
        assert data["joined_task_sets"] == []

    async def test_get_profile_sorts_recent_sets_first_and_completed_last(
        self,
        client,
        db_session,
        test_teacher,
        task,
    ):
        """Test that task sets are newest-first, with completed sets grouped after active ones."""
        active_set = TaskSet(
            teacher_id=test_teacher.id,
            title="Active Set",
            unique_link_code="ACTIVESET"
        )
        completed_set = TaskSet(
            teacher_id=test_teacher.id,
            title="Completed Set",
            unique_link_code="DONESET"
        )
        db_session.add_all([active_set, completed_set])
        await db_session.commit()
        await db_session.refresh(active_set)
        await db_session.refresh(completed_set)

        db_session.add_all([
            TaskSetItem(task_set_id=active_set.id, task_id=task.id),
            TaskSetItem(task_set_id=completed_set.id, task_id=task.id),
        ])
        await db_session.commit()

        student = Student(username="sortstu", email="sortstu@example.com")
        student.set_password("studentpass123")
        db_session.add(student)
        await db_session.commit()
        await db_session.refresh(student)

        await client.post(
            "/api/student_login",
            json={"email": "sortstu@example.com", "password": "studentpass123"}
        )

        db_session.add_all([
            StudentTaskSetEnrollment(student_id=student.id, task_set_id=active_set.id),
            StudentTaskSetEnrollment(student_id=student.id, task_set_id=completed_set.id),
        ])
        await db_session.commit()

        active_enrollment = StudentTaskEnrollment(
            student_id=student.id,
            task_id=task.id,
            task_set_id=active_set.id,
        )
        completed_enrollment = StudentTaskEnrollment(
            student_id=student.id,
            task_id=task.id,
            task_set_id=completed_set.id,
        )
        db_session.add_all([active_enrollment, completed_enrollment])
        await db_session.flush()

        db_session.add(TaskAttempt(
            student_id=student.id,
            task_id=task.id,
            student_task_enrollment_id=completed_enrollment.id,
            success=True,
        ))
        await db_session.commit()

        profile_resp = await client.get("/api/student/profile")
        assert profile_resp.status_code == status.HTTP_200_OK

        data = profile_resp.json()["joined_task_sets"]
        assert [item["title"] for item in data] == ["Active Set", "Completed Set"]
        assert data[0]["is_completed"] is False
        assert data[1]["is_completed"] is True

    async def test_update_email_success(self, client, db_session):
        """Test successfully updating the student's email."""
        student = Student(username="emailstu", email="old_email@example.com")
        student.set_password("securepassword")
        db_session.add(student)
        await db_session.commit()
        await db_session.refresh(student)

        # Login
        await client.post(
            "/api/student_login",
            json={"email": "old_email@example.com", "password": "securepassword"}
        )

        # Update Email
        update_resp = await client.post(
            "/api/student/profile/email",
            json={"email": "new_email@example.com", "password": "securepassword"}
        )
        assert update_resp.status_code == 200
        assert update_resp.json()["status"] == "success"

        # Check DB
        stmt = select(Student).where(Student.username == "emailstu")
        res = await db_session.execute(stmt)
        updated_student = res.scalar_one()
        assert updated_student.email == "new_email@example.com"

    async def test_update_email_failures(self, client, db_session):
        """Test updating email validation failures."""
        student1 = Student(username="failstu1", email="failstu1@example.com")
        student1.set_password("securepassword")
        student2 = Student(username="failstu2", email="failstu2@example.com")
        student2.set_password("securepassword")
        db_session.add_all([student1, student2])
        await db_session.commit()

        # Login student1
        await client.post(
            "/api/student_login",
            json={"email": "failstu1@example.com", "password": "securepassword"}
        )

        # 1. Incorrect password
        resp = await client.post(
            "/api/student/profile/email",
            json={"email": "another@example.com", "password": "wrongpassword"}
        )
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert "Incorrect password" in resp.json()["detail"]

        # 2. Invalid email format
        resp = await client.post(
            "/api/student/profile/email",
            json={"email": "invalid-email-no-at", "password": "securepassword"}
        )
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert "Invalid email format" in resp.json()["detail"]

        # 3. Email already in use
        resp = await client.post(
            "/api/student/profile/email",
            json={"email": "failstu2@example.com", "password": "securepassword"}
        )
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert "Email is already in use" in resp.json()["detail"]

    async def test_update_password_success(self, client, db_session):
        """Test successfully updating the student's password and logging back in."""
        student = Student(username="pwstu", email="pwstu@example.com")
        student.set_password("pwstu_old")
        db_session.add(student)
        await db_session.commit()

        # Login
        await client.post(
            "/api/student_login",
            json={"email": "pwstu@example.com", "password": "pwstu_old"}
        )

        # Update Password
        update_resp = await client.post(
            "/api/student/profile/password",
            json={
                "current_password": "pwstu_old",
                "new_password": "pwstu_new_secure",
                "new_password_confirm": "pwstu_new_secure"
            }
        )
        assert update_resp.status_code == 200
        assert update_resp.json()["status"] == "success"

        # Logout
        await client.post("/api/student_logout")

        # Login with old password should fail
        login_fail = await client.post(
            "/api/student_login",
            json={"email": "pwstu@example.com", "password": "pwstu_old"}
        )
        assert login_fail.status_code == status.HTTP_400_BAD_REQUEST

        # Login with new password should succeed
        login_success = await client.post(
            "/api/student_login",
            json={"email": "pwstu@example.com", "password": "pwstu_new_secure"}
        )
        assert login_success.status_code == 200

    async def test_update_password_failures(self, client, db_session):
        """Test validation failures when updating student password."""
        student = Student(username="pwfailstu", email="pwfailstu@example.com")
        student.set_password("original_pw")
        db_session.add(student)
        await db_session.commit()

        # Login
        await client.post(
            "/api/student_login",
            json={"email": "pwfailstu@example.com", "password": "original_pw"}
        )

        # 1. Incorrect current password
        resp = await client.post(
            "/api/student/profile/password",
            json={
                "current_password": "wrong_current",
                "new_password": "new_password_123",
                "new_password_confirm": "new_password_123"
            }
        )
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert "Incorrect current password" in resp.json()["detail"]

        # 2. Mismatched confirmation
        resp = await client.post(
            "/api/student/profile/password",
            json={
                "current_password": "original_pw",
                "new_password": "new_password_123",
                "new_password_confirm": "new_password_different"
            }
        )
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert "New passwords do not match" in resp.json()["detail"]

        # 3. Too short password
        resp = await client.post(
            "/api/student/profile/password",
            json={
                "current_password": "original_pw",
                "new_password": "short",
                "new_password_confirm": "short"
            }
        )
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert "minimum length of 8 characters" in resp.json()["detail"]
