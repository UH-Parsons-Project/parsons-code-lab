"""
Unit tests for teacher profile and credentials update API endpoints.
"""

import pytest
from fastapi import status
from sqlalchemy import select

from backend.models import Teacher

@pytest.mark.asyncio
class TestTeacherProfileApi:
    """Tests for teacher profile and change credentials endpoints."""

    async def test_get_profile_unauthorized(self, client):
        """Test that get profile returns 401 when teacher is not logged in."""
        resp = await client.get("/api/teacher/profile")
        assert resp.status_code == status.HTTP_401_UNAUTHORIZED

    async def test_get_profile_authorized(self, client, test_teacher):
        """Test retrieving logged-in teacher profile details."""
        # Login
        login_resp = await client.post(
            "/api/login/access-token",
            data={"username": "test@example.com", "password": "testpassword123"},
        )
        assert login_resp.status_code == 200

        # Fetch profile API
        profile_resp = await client.get("/api/teacher/profile")
        assert profile_resp.status_code == 200
        
        data = profile_resp.json()
        assert data["username"] == "testteacher"
        assert data["email"] == "test@example.com"
        assert "created_at" in data

    async def test_update_email_success(self, client, db_session, test_teacher):
        """Test successfully updating the teacher's email."""
        # Login
        await client.post(
            "/api/login/access-token",
            data={"username": "test@example.com", "password": "testpassword123"},
        )

        # Update Email
        update_resp = await client.post(
            "/api/teacher/profile/email",
            json={"email": "new_teacher_email@example.com", "password": "testpassword123"}
        )
        assert update_resp.status_code == 200
        assert update_resp.json()["status"] == "success"

        # Check DB
        stmt = select(Teacher).where(Teacher.username == "testteacher")
        res = await db_session.execute(stmt)
        updated_teacher = res.scalar_one()
        assert updated_teacher.email == "new_teacher_email@example.com"

    async def test_update_email_failures(self, client, db_session, test_teacher):
        """Test updating email validation failures."""
        # Create a second teacher to test email already in use
        teacher2 = Teacher(username="teacher2", email="teacher2@example.com")
        teacher2.set_password("securepassword")
        db_session.add(teacher2)
        await db_session.commit()

        # Login test_teacher
        await client.post(
            "/api/login/access-token",
            data={"username": "test@example.com", "password": "testpassword123"},
        )

        # 1. Incorrect password
        resp = await client.post(
            "/api/teacher/profile/email",
            json={"email": "another@example.com", "password": "wrongpassword"}
        )
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert "Incorrect password" in resp.json()["detail"]

        # 2. Invalid email format
        resp = await client.post(
            "/api/teacher/profile/email",
            json={"email": "invalid-email-no-at", "password": "testpassword123"}
        )
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert "Invalid email format" in resp.json()["detail"]

        # 3. Email already in use
        resp = await client.post(
            "/api/teacher/profile/email",
            json={"email": "teacher2@example.com", "password": "testpassword123"}
        )
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert "Email is already in use" in resp.json()["detail"]

    async def test_update_password_success(self, client, db_session, test_teacher):
        """Test successfully updating the teacher's password and logging back in."""
        # Login
        await client.post(
            "/api/login/access-token",
            data={"username": "test@example.com", "password": "testpassword123"},
        )

        # Update Password
        update_resp = await client.post(
            "/api/teacher/profile/password",
            json={
                "current_password": "testpassword123",
                "new_password": "newpassword123",
                "new_password_confirm": "newpassword123"
            }
        )
        assert update_resp.status_code == 200
        assert update_resp.json()["status"] == "success"

        # Logout
        await client.post("/api/logout")

        # Login with old password should fail
        login_fail = await client.post(
            "/api/login/access-token",
            data={"username": "test@example.com", "password": "testpassword123"},
        )
        assert login_fail.status_code == status.HTTP_400_BAD_REQUEST

        # Login with new password should succeed
        login_success = await client.post(
            "/api/login/access-token",
            data={"username": "test@example.com", "password": "newpassword123"},
        )
        assert login_success.status_code == 200

    async def test_update_password_failures(self, client, db_session, test_teacher):
        """Test validation failures when updating teacher password."""
        # Login
        await client.post(
            "/api/login/access-token",
            data={"username": "test@example.com", "password": "testpassword123"},
        )

        # 1. Incorrect current password
        resp = await client.post(
            "/api/teacher/profile/password",
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
            "/api/teacher/profile/password",
            json={
                "current_password": "testpassword123",
                "new_password": "new_password_123",
                "new_password_confirm": "new_password_different"
            }
        )
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert "New passwords do not match" in resp.json()["detail"]

        # 3. Too short password
        resp = await client.post(
            "/api/teacher/profile/password",
            json={
                "current_password": "testpassword123",
                "new_password": "short",
                "new_password_confirm": "short"
            }
        )
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert "minimum length of 8 characters" in resp.json()["detail"]
