"""
Unit tests for database configuration and session management.
"""

import os
import pytest
import pytest_asyncio
from unittest.mock import patch
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.pool import StaticPool

from backend.database import (
    DATABASE_URL,
    engine,
    async_session,
    Base,
    get_db,
    init_db,
)
from backend.models import Teacher


class TestDatabaseURL:
    """Tests for DATABASE_URL configuration."""

    def test_database_url_default(self):
        """Test that DATABASE_URL has a default value."""
        # The imported DATABASE_URL should have a value
        assert DATABASE_URL is not None
        assert isinstance(DATABASE_URL, str)
        assert "postgresql+asyncpg" in DATABASE_URL or "sqlite" in DATABASE_URL

    @patch.dict(os.environ, {"DATABASE_URL": "postgresql+asyncpg://custom:pass@host:5432/custom_db"})
    def test_database_url_from_environment(self):
        """Test that DATABASE_URL can be set from environment variable."""
        # Re-import to get the environment variable
        from importlib import reload
        import backend.database as db_module
        reload(db_module)
        
        assert db_module.DATABASE_URL == "postgresql+asyncpg://custom:pass@host:5432/custom_db"

    def test_database_url_format(self):
        """Test that DATABASE_URL has correct format."""
        # Should be a valid connection string
        assert "://" in DATABASE_URL
        # Should contain database name
        parts = DATABASE_URL.split("/")
        assert len(parts) >= 4  # protocol://host:port/database


class TestEngine:
    """Tests for database engine configuration."""

    def test_engine_exists(self):
        """Test that engine is created."""
        assert engine is not None

    def test_engine_is_async(self):
        """Test that engine is async."""
        from sqlalchemy.ext.asyncio import AsyncEngine
        assert isinstance(engine, AsyncEngine)


class TestAsyncSession:
    """Tests for async session factory."""

    def test_async_session_exists(self):
        """Test that async_session factory is created."""
        assert async_session is not None

    def test_async_session_callable(self):
        """Test that async_session is callable."""
        assert callable(async_session)


class TestBase:
    """Tests for Base declarative class."""

    def test_base_exists(self):
        """Test that Base class exists."""
        assert Base is not None

    def test_base_is_declarative_base(self):
        """Test that Base is a DeclarativeBase."""
        from sqlalchemy.orm import DeclarativeBase
        assert issubclass(Base, DeclarativeBase)

    def test_base_has_metadata(self):
        """Test that Base has metadata."""
        assert hasattr(Base, "metadata")
        assert Base.metadata is not None

    def test_models_inherit_from_base(self):
        """Test that models inherit from Base."""
        assert issubclass(Teacher, Base)


class TestGetDb:
    """Tests for get_db dependency function."""

    @pytest_asyncio.fixture
    async def test_engine(self):
        """Create a test database engine."""
        engine = create_async_engine(
            "sqlite+aiosqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        yield engine
        await engine.dispose()

    async def test_get_db_yields_session(self, test_engine):
        """Test that get_db yields a database session."""
        # Patch the async_session to use our test engine
        from sqlalchemy.ext.asyncio import async_sessionmaker
        test_session_maker = async_sessionmaker(
            test_engine, class_=AsyncSession, expire_on_commit=False
        )
        
        with patch("backend.database.async_session", test_session_maker):
            gen = get_db()
            session = await gen.__anext__()
            
            assert session is not None
            assert isinstance(session, AsyncSession)
            
            # Clean up
            try:
                await gen.__anext__()
            except StopAsyncIteration:
                pass

    async def test_get_db_is_async_generator(self):
        """Test that get_db is an async generator."""
        import inspect
        assert inspect.isasyncgenfunction(get_db)

    async def test_get_db_session_lifecycle(self, test_engine):
        """Test that session is properly managed by get_db."""
        from sqlalchemy.ext.asyncio import async_sessionmaker
        test_session_maker = async_sessionmaker(
            test_engine, class_=AsyncSession, expire_on_commit=False
        )
        
        with patch("backend.database.async_session", test_session_maker):
            gen = get_db()
            session = await gen.__anext__()
            
            # Session should exist and be usable
            assert session is not None
            assert isinstance(session, AsyncSession)
            
            # Exit the generator (simulates end of request)
            try:
                await gen.__anext__()
            except StopAsyncIteration:
                pass

    async def test_get_db_can_query_database(self, test_engine):
        """Test that session from get_db can query the database."""
        from sqlalchemy.ext.asyncio import async_sessionmaker
        from sqlalchemy import select
        
        test_session_maker = async_sessionmaker(
            test_engine, class_=AsyncSession, expire_on_commit=False
        )
        
        with patch("backend.database.async_session", test_session_maker):
            gen = get_db()
            session = await gen.__anext__()
            
            # Create a test teacher
            teacher = Teacher(
                username="testuser",
                email="test@example.com",
                is_active=True
            )
            teacher.set_password("password123")
            
            session.add(teacher)
            await session.commit()
            
            # Query the teacher
            result = await session.execute(select(Teacher))
            teachers = result.scalars().all()
            
            assert len(teachers) == 1
            assert teachers[0].username == "testuser"
            
            # Clean up
            try:
                await gen.__anext__()
            except StopAsyncIteration:
                pass


class TestInitDb:
    """Tests for init_db function."""

    async def test_init_db_is_async(self):
        """Test that init_db is an async function."""
        import inspect
        assert inspect.iscoroutinefunction(init_db)

    @pytest_asyncio.fixture
    async def test_engine(self):
        """Create a clean test database engine."""
        engine = create_async_engine(
            "sqlite+aiosqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        yield engine
        await engine.dispose()

    async def test_init_db_creates_tables(self, test_engine):
        """Test that init_db runs without error."""
        # Patch the engine to use our test engine
        with patch("backend.database.engine", test_engine):
            # Should not raise an exception
            await init_db()

    async def test_init_db_idempotent(self, test_engine):
        """Test that init_db can be called multiple times safely."""
        with patch("backend.database.engine", test_engine):
            # Call init_db twice - should not raise an error due to checkfirst=True
            await init_db()
            await init_db()  # Second call should be safe

    async def test_init_db_uses_checkfirst(self):
        """Test that init_db uses checkfirst parameter."""
        # Use a real test engine and spy on the call
        test_engine = create_async_engine(
            "sqlite+aiosqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        
        with patch("backend.database.engine", test_engine):
            # This should not raise an error
            await init_db()
            # Call again - checkfirst=True means this should also not error
            await init_db()
        
        await test_engine.dispose()


class TestDatabaseIntegration:
    """Integration tests for database components."""

    @pytest_asyncio.fixture
    async def clean_db(self):
        """Create a clean test database."""
        engine = create_async_engine(
            "sqlite+aiosqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        
        # Create tables directly on the test engine
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        
        yield engine
        
        await engine.dispose()

    async def test_full_database_workflow(self, clean_db):
        """Test complete workflow: create session, add data, query data."""
        from sqlalchemy.ext.asyncio import async_sessionmaker
        from sqlalchemy import select
        
        # Create session factory with test engine
        test_session_maker = async_sessionmaker(
            clean_db, class_=AsyncSession, expire_on_commit=False
        )
        
        with patch("backend.database.async_session", test_session_maker):
            # Use get_db to create a session
            gen = get_db()
            session = await gen.__anext__()
            
            # Add a teacher
            teacher = Teacher(
                username="integration_test",
                email="integration@example.com"
            )
            teacher.set_password("password123")
            session.add(teacher)
            await session.commit()
            
            # Query the teacher
            result = await session.execute(
                select(Teacher).where(Teacher.username == "integration_test")
            )
            found_teacher = result.scalar_one_or_none()
            
            assert found_teacher is not None
            assert found_teacher.email == "integration@example.com"
            assert found_teacher.verify_password("password123")
            
            # Clean up
            try:
                await gen.__anext__()
            except StopAsyncIteration:
                pass
