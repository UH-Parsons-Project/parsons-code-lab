"""
Unit tests for the registration endpoint.
"""

import pytest
from fastapi import status
from sqlalchemy import select

from backend.models import Teacher


class TestRegisterEndpoint:
    async def test_register_success(self, client, db_session):
        payload = {
            "username": "newteacher",
            "password": "strongpassword",
            "password_confirm": "strongpassword",
            "email": "newteacher@example.com",
        }

        response = await client.post("/api/register", json=payload)

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data.get("status") == "success"
        assert "id" in data

        # Verify user exists in DB and password is set
        result = await db_session.execute(select(Teacher).where(Teacher.username == "newteacher"))
        teacher = result.scalar_one_or_none()
        assert teacher is not None
        assert teacher.email == "newteacher@example.com"
        assert teacher.verify_password("strongpassword")

    async def test_register_missing_fields(self, client):
        payload = {"username": "u", "password": "p"}  # missing email and password_confirm
        response = await client.post("/api/register", json=payload)

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "username, password and email are required" in response.json().get("detail", "")

    async def test_register_password_mismatch(self, client):
        payload = {
            "username": "u2",
            "password": "one",
            "password_confirm": "two",
            "email": "u2@example.com",
        }
        response = await client.post("/api/register", json=payload)

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "Passwords do not match" in response.json().get("detail", "")

    async def test_register_existing_username_or_email(self, client, test_teacher):
        # Try to register with the same username
        payload = {
            "username": "testteacher",
            "password": "anotherpass",
            "password_confirm": "anotherpass",
            "email": "unique_email@example.com",
        }
        response = await client.post("/api/register", json=payload)
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "Username or email already exists" in response.json().get("detail", "")

        # Try to register with the same email
        payload = {
            "username": "uniqueuser",
            "password": "anotherpass",
            "password_confirm": "anotherpass",
            "email": "test@example.com",
        }
        response = await client.post("/api/register", json=payload)
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "Username or email already exists" in response.json().get("detail", "")
