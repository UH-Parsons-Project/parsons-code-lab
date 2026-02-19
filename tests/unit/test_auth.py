"""
Unit tests for authentication module.
"""

import pytest
from datetime import timedelta
from jose import jwt
from fastapi import HTTPException

from backend.auth import (
    create_access_token,
    authenticate_user,
    get_current_user,
    SECRET_KEY,
    ALGORITHM
)
from backend.models import Teacher


class TestCreateAccessToken:
    """Tests for JWT token creation."""

    def test_create_access_token_basic(self):
        """Test creating a basic access token."""
        data = {"sub": "testuser"}
        token = create_access_token(data)

        assert token is not None
        assert isinstance(token, str)

        # Decode and verify token content
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        assert payload["sub"] == "testuser"
        assert "exp" in payload

    def test_create_access_token_with_expiry(self):
        """Test creating a token with custom expiration."""
        data = {"sub": "testuser"}
        expires_delta = timedelta(minutes=30)
        token = create_access_token(data, expires_delta)

        assert token is not None
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        assert payload["sub"] == "testuser"

    def test_create_access_token_includes_additional_data(self):
        """Test that additional data is preserved in the token."""
        data = {"sub": "testuser", "role": "teacher", "email": "test@example.com"}
        token = create_access_token(data)

        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        assert payload["sub"] == "testuser"
        assert payload["role"] == "teacher"
        assert payload["email"] == "test@example.com"


class TestAuthenticateUser:
    """Tests for user authentication."""

    async def test_authenticate_valid_user(self, db_session, test_teacher):
        """Test authenticating with valid credentials."""
        user = await authenticate_user("testteacher", "testpassword123", db_session)

        assert user is not None
        assert user.username == "testteacher"
        assert user.email == "test@example.com"

    async def test_authenticate_wrong_password(self, db_session, test_teacher):
        """Test authentication fails with wrong password."""
        user = await authenticate_user("testteacher", "wrongpassword", db_session)

        assert user is None

    async def test_authenticate_nonexistent_user(self, db_session):
        """Test authentication fails for non-existent user."""
        user = await authenticate_user("nonexistent", "password", db_session)

        assert user is None

    async def test_authenticate_inactive_user(self, db_session, inactive_teacher):
        """Test authentication fails for inactive users."""
        user = await authenticate_user("inactiveteacher", "testpassword123", db_session)

        assert user is None

    async def test_authenticate_empty_password(self, db_session, test_teacher):
        """Test authentication fails with empty password."""
        user = await authenticate_user("testteacher", "", db_session)

        assert user is None


class TestGetCurrentUser:
    """Tests for getting current authenticated user."""

    async def test_get_current_user_with_valid_token_in_cookie(
        self, db_session, test_teacher
    ):
        """Test getting current user with valid token in cookie."""
        from unittest.mock import Mock

        # Create a valid token
        token = create_access_token({"sub": test_teacher.username})

        # Mock request with cookie
        request = Mock()
        request.cookies = {"access_token": token}
        request.headers = {}

        user = await get_current_user(request, db_session)

        assert user is not None
        assert user.username == test_teacher.username
        assert user.email == test_teacher.email

    async def test_get_current_user_with_valid_token_in_header(
        self, db_session, test_teacher
    ):
        """Test getting current user with valid token in Authorization header."""
        from unittest.mock import Mock

        # Create a valid token
        token = create_access_token({"sub": test_teacher.username})

        # Mock request with Authorization header
        request = Mock()
        request.cookies = {}
        request.headers = {"Authorization": f"Bearer {token}"}

        user = await get_current_user(request, db_session)

        assert user is not None
        assert user.username == test_teacher.username

    async def test_get_current_user_with_no_token(self, db_session):
        """Test that missing token raises HTTPException."""
        from unittest.mock import Mock

        request = Mock()
        request.cookies = {}
        request.headers = {}

        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(request, db_session)

        assert exc_info.value.status_code == 401
        assert "Could not validate credentials" in exc_info.value.detail

    async def test_get_current_user_with_invalid_token(self, db_session):
        """Test that invalid token raises HTTPException."""
        from unittest.mock import Mock

        request = Mock()
        request.cookies = {"access_token": "invalid_token"}
        request.headers = {}

        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(request, db_session)

        assert exc_info.value.status_code == 401

    async def test_get_current_user_with_nonexistent_username(self, db_session):
        """Test that token with non-existent username raises HTTPException."""
        from unittest.mock import Mock

        # Create token for non-existent user
        token = create_access_token({"sub": "nonexistentuser"})

        request = Mock()
        request.cookies = {"access_token": token}
        request.headers = {}

        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(request, db_session)

        assert exc_info.value.status_code == 401

    async def test_get_current_user_with_inactive_user(
        self, db_session, inactive_teacher
    ):
        """Test that inactive user raises HTTPException."""
        from unittest.mock import Mock

        # Create token for inactive user
        token = create_access_token({"sub": inactive_teacher.username})

        request = Mock()
        request.cookies = {"access_token": token}
        request.headers = {}

        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(request, db_session)

        assert exc_info.value.status_code == 401

    async def test_get_current_user_token_without_sub(self, db_session):
        """Test that token without 'sub' field raises HTTPException."""
        from unittest.mock import Mock

        # Create token without username (sub)
        token = create_access_token({"user": "testuser"})  # Wrong key

        request = Mock()
        request.cookies = {"access_token": token}
        request.headers = {}

        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(request, db_session)

        assert exc_info.value.status_code == 401