"""
Pytest configuration and fixtures for unit tests.
"""

import uuid
import pytest
import pytest_asyncio
from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.pool import StaticPool
from httpx import AsyncClient, ASGITransport

# Handle different SQLAlchemy versions
try:
    from sqlalchemy.ext.asyncio import async_sessionmaker
except ImportError:
    from sqlalchemy.orm import sessionmaker
    async_sessionmaker = sessionmaker

from backend.database import Base, get_db
from backend.main import app
from backend.models import Parsons, StudentSession, TaskList, TaskListItem, Teacher


@pytest_asyncio.fixture
async def db_engine():
    """Create a test database engine with in-memory SQLite."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield engine

    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(db_engine) -> AsyncGenerator[AsyncSession, None]:
    """Create a database session for testing."""
    try:
        async_session_maker = async_sessionmaker(
            db_engine, class_=AsyncSession, expire_on_commit=False
        )
    except TypeError:
        # Fallback for older SQLAlchemy versions
        from sqlalchemy.orm import sessionmaker
        async_session_maker = sessionmaker(
            db_engine, class_=AsyncSession, expire_on_commit=False
        )

    async with async_session_maker() as session:
        yield session
        await session.rollback()


@pytest_asyncio.fixture
async def client(db_session):
    """Create a test client with dependency overrides."""
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test"
    ) as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def test_teacher(db_session) -> Teacher:
    """Create a test teacher user."""
    teacher = Teacher(
        username="testteacher",
        email="test@example.com",
        is_active=True
    )
    teacher.set_password("testpassword123")

    db_session.add(teacher)
    await db_session.commit()
    await db_session.refresh(teacher)

    return teacher


@pytest_asyncio.fixture
async def inactive_teacher(db_session) -> Teacher:
    """Create an inactive test teacher user."""
    teacher = Teacher(
        username="inactiveteacher",
        email="inactive@example.com",
        is_active=False
    )
    teacher.set_password("testpassword123")

    db_session.add(teacher)
    await db_session.commit()
    await db_session.refresh(teacher)

    return teacher


@pytest.fixture
def valid_token_data() -> dict:
    """Return valid token data for testing."""
    return {"sub": "testteacher"}


# ---------------------------------------------------------------------------
# Shared domain-object fixtures
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def task(db_session, test_teacher) -> Parsons:
    """A single public Parsons task owned by test_teacher."""
    t = Parsons(
        created_by_teacher_id=test_teacher.id,
        title="Hello World",
        description='{"description": "Print hello world."}',
        task_instructions="Arrange the blocks to print 'Hello, World!'",
        task_type="python",
        code_blocks={"blocks": ["print('Hello, World!')"]},
        correct_solution={"solution": ["print('Hello, World!')"]},
        is_public=True,
    )
    db_session.add(t)
    await db_session.commit()
    await db_session.refresh(t)
    return t


@pytest_asyncio.fixture
async def private_task(db_session, test_teacher) -> Parsons:
    """A private (not public) Parsons task owned by test_teacher."""
    t = Parsons(
        created_by_teacher_id=test_teacher.id,
        title="Private Task",
        description='{"description": "Internal only."}',
        task_type="python",
        code_blocks={"blocks": []},
        correct_solution={"solution": []},
        is_public=False,
    )
    db_session.add(t)
    await db_session.commit()
    await db_session.refresh(t)
    return t


@pytest_asyncio.fixture
async def problemset(db_session, test_teacher) -> TaskList:
    """A problem set (TaskList) owned by test_teacher."""
    ps = TaskList(
        teacher_id=test_teacher.id,
        title="Week 1 Exercises",
        unique_link_code="WEEK1",
    )
    db_session.add(ps)
    await db_session.commit()
    await db_session.refresh(ps)
    return ps


@pytest_asyncio.fixture
async def problemset_with_task(db_session, problemset, task) -> tuple[TaskList, Parsons]:
    """A problem set that already contains *task*."""
    item = TaskListItem(task_list_id=problemset.id, task_id=task.id)
    db_session.add(item)
    await db_session.commit()
    return problemset, task


@pytest_asyncio.fixture
async def student_session(db_session, problemset) -> StudentSession:
    """A student session associated with *problemset*."""
    ss = StudentSession(
        session_id=uuid.uuid4(),
        task_list_id=problemset.id,
        username="student1",
    )
    db_session.add(ss)
    await db_session.commit()
    await db_session.refresh(ss)
    return ss