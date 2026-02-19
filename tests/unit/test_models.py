"""
Unit tests for database models.
"""

import pytest
from backend.models import Teacher


class TestTeacherModel:
    """Tests for the Teacher model."""

    def test_teacher_creation(self, test_teacher):
        """Test that a teacher can be created with all required fields."""
        assert test_teacher.id is not None
        assert test_teacher.username == "testteacher"
        assert test_teacher.email == "test@example.com"
        assert test_teacher.is_active is True
        assert test_teacher.created_at is not None
        assert test_teacher.updated_at is not None

    def test_set_password(self):
        """Test that set_password properly hashes the password."""
        teacher = Teacher(
            username="newteacher",
            email="new@example.com"
        )
        teacher.set_password("mypassword")

        assert teacher.password_hash is not None
        assert teacher.password_hash != "mypassword"
        assert len(teacher.password_hash) > 0

    def test_verify_password_correct(self, test_teacher):
        """Test that verify_password returns True for correct password."""
        assert test_teacher.verify_password("testpassword123") is True

    def test_verify_password_incorrect(self, test_teacher):
        """Test that verify_password returns False for incorrect password."""
        assert test_teacher.verify_password("wrongpassword") is False
        assert test_teacher.verify_password("") is False
        assert test_teacher.verify_password("testpassword") is False

    def test_password_is_hashed(self, test_teacher):
        """Test that password is stored as a hash, not plaintext."""
        assert test_teacher.password_hash != "testpassword123"
        # bcrypt hashes start with $2b$
        assert test_teacher.password_hash.startswith("$2b$")

    async def test_teacher_unique_username(self, db_session):
        """Test that usernames must be unique."""
        teacher1 = Teacher(
            username="uniqueuser",
            email="user1@example.com"
        )
        teacher1.set_password("password")
        db_session.add(teacher1)
        await db_session.commit()

        teacher2 = Teacher(
            username="uniqueuser",  # Same username
            email="user2@example.com"
        )
        teacher2.set_password("password")
        db_session.add(teacher2)

        with pytest.raises(Exception):  # Will raise an integrity error
            await db_session.commit()

    async def test_teacher_unique_email(self, db_session):
        """Test that emails must be unique."""
        teacher1 = Teacher(
            username="user1",
            email="same@example.com"
        )
        teacher1.set_password("password")
        db_session.add(teacher1)
        await db_session.commit()

        teacher2 = Teacher(
            username="user2",
            email="same@example.com"  # Same email
        )
        teacher2.set_password("password")
        db_session.add(teacher2)

        with pytest.raises(Exception):  # Will raise an integrity error
            await db_session.commit()

    async def test_inactive_teacher(self, inactive_teacher):
        """Test that inactive teacher has is_active=False."""
        assert inactive_teacher.is_active is False
        assert inactive_teacher.username == "inactiveteacher"
        # Should still be able to verify password even if inactive
        assert inactive_teacher.verify_password("testpassword123") is True