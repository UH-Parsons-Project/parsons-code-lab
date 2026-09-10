import pytest
import pytest_asyncio
from datetime import datetime, timezone
from sqlalchemy import select
from backend.teacher_auth import create_access_token, authenticate_user
from backend.models import Teacher, Student, Parsons, TaskSet, TaskSetItem, ModelAnswer

def _auth(username: str) -> dict:
    """Return an Authorization header dict for the given teacher username."""
    return {"Authorization": f"Bearer {create_access_token({'sub': username})}"}

@pytest_asyncio.fixture
async def admin_teacher(db_session) -> Teacher:
    """Create an admin teacher user."""
    teacher = Teacher(
        username="adminteacher",
        email="admin@example.com",
        is_active=True,
        is_admin_teacher=True,
    )
    teacher.set_password("adminpassword123")

    db_session.add(teacher)
    await db_session.commit()
    await db_session.refresh(teacher)

    return teacher

@pytest_asyncio.fixture
async def target_teacher(db_session) -> Teacher:
    """Create a teacher user to be deleted."""
    teacher = Teacher(
        username="targetteacher",
        email="target@example.com",
        is_active=True,
        is_admin_teacher=False,
    )
    teacher.set_password("password123")

    db_session.add(teacher)
    await db_session.commit()
    await db_session.refresh(teacher)

    return teacher

@pytest.mark.asyncio
async def test_admin_can_soft_delete_teacher(client, db_session, admin_teacher, target_teacher):
    # 1. Create a public task, a private task inside a task set, and a private task outside task set.
    # Public task
    pub_task = Parsons(
        created_by_teacher_id=target_teacher.id,
        title="Public Task",
        task_instructions='{"task_instructions": "Solve it"}',
        description='{"description": "A public task"}',
        task_type="parsons",
        code_blocks={},
        correct_solution={},
        is_public=True
    )
    db_session.add(pub_task)
    
    # Private task in task set
    priv_task_in_set = Parsons(
        created_by_teacher_id=target_teacher.id,
        title="Private Task In Set",
        task_instructions='{"task_instructions": "Solve it"}',
        description='{"description": "A private task in a set"}',
        task_type="parsons",
        code_blocks={},
        correct_solution={},
        is_public=False
    )
    db_session.add(priv_task_in_set)

    # Private task NOT in task set
    priv_task_out_set = Parsons(
        created_by_teacher_id=target_teacher.id,
        title="Private Task Outside Set",
        task_instructions='{"task_instructions": "Solve it"}',
        description='{"description": "A private task outside set"}',
        task_type="parsons",
        code_blocks={},
        correct_solution={},
        is_public=False
    )
    db_session.add(priv_task_out_set)
    await db_session.commit()

    # Model answers
    ma_pub = ModelAnswer(
        parsons_id=pub_task.id,
        created_by_teacher_id=target_teacher.id,
        answer_code="def solve(): pass"
    )
    db_session.add(ma_pub)

    ma_priv_in = ModelAnswer(
        parsons_id=priv_task_in_set.id,
        created_by_teacher_id=target_teacher.id,
        answer_code="def solve(): pass"
    )
    db_session.add(ma_priv_in)

    ma_priv_out = ModelAnswer(
        parsons_id=priv_task_out_set.id,
        created_by_teacher_id=target_teacher.id,
        answer_code="def solve(): pass"
    )
    db_session.add(ma_priv_out)

    # Task Set
    task_set = TaskSet(
        teacher_id=target_teacher.id,
        title="List One",
        unique_link_code="list-one",
        expires_at=None
    )
    db_session.add(task_set)
    await db_session.commit()

    # Task Set Item linking private task
    item = TaskSetItem(
        task_set_id=task_set.id,
        task_id=priv_task_in_set.id
    )
    db_session.add(item)
    await db_session.commit()

    # Keep track of IDs
    pub_task_id = pub_task.id
    priv_task_in_set_id = priv_task_in_set.id
    priv_task_out_set_id = priv_task_out_set.id
    task_set_id = task_set.id
    target_teacher_id = target_teacher.id
    target_teacher_username = target_teacher.username

    # Call delete endpoint
    r = await client.request(
        "DELETE",
        f"/api/admin/users/teacher/{target_teacher_id}",
        headers=_auth(admin_teacher.username),
        json={"admin_password": "adminpassword123"}
    )
    assert r.status_code == 200
    assert r.json() == {"status": "success", "message": "Teacher deleted"}

    # Refresh DB session
    db_session.expire_all()

    # Verify target teacher is deleted
    stmt = select(Teacher).where(Teacher.id == target_teacher_id)
    res = await db_session.execute(stmt)
    assert res.scalar_one_or_none() is None

    # Verify deleted_user exists with ID 999999
    stmt = select(Teacher).where(Teacher.id == 999999)
    res = await db_session.execute(stmt)
    deleted_user = res.scalar_one_or_none()
    assert deleted_user is not None
    assert deleted_user.username == "deleted_user"
    assert deleted_user.is_active is False

    # Verify public task belongs to deleted_user
    stmt = select(Parsons).where(Parsons.id == pub_task_id)
    res = await db_session.execute(stmt)
    moved_pub = res.scalar_one_or_none()
    assert moved_pub is not None
    assert moved_pub.created_by_teacher_id == 999999

    # Verify private task in set is deleted (GDPR requirement)
    stmt = select(Parsons).where(Parsons.id == priv_task_in_set_id)
    res = await db_session.execute(stmt)
    assert res.scalar_one_or_none() is None

    # Verify private task outside set is deleted
    stmt = select(Parsons).where(Parsons.id == priv_task_out_set_id)
    res = await db_session.execute(stmt)
    assert res.scalar_one_or_none() is None

    # Verify model answers
    stmt = select(ModelAnswer).where(ModelAnswer.parsons_id == pub_task_id)
    res = await db_session.execute(stmt)
    ma_pub_check = res.scalar_one_or_none()
    assert ma_pub_check is not None
    assert ma_pub_check.created_by_teacher_id == 999999

    stmt = select(ModelAnswer).where(ModelAnswer.parsons_id == priv_task_in_set_id)
    res = await db_session.execute(stmt)
    assert res.scalar_one_or_none() is None

    stmt = select(ModelAnswer).where(ModelAnswer.parsons_id == priv_task_out_set_id)
    res = await db_session.execute(stmt)
    assert res.scalar_one_or_none() is None

    # Verify task set is now owned by deleted_user and is expired
    stmt = select(TaskSet).where(TaskSet.id == task_set_id)
    res = await db_session.execute(stmt)
    moved_set = res.scalar_one_or_none()
    assert moved_set is not None
    assert moved_set.teacher_id == 999999
    assert moved_set.expires_at is not None
    
    moved_set_expires = moved_set.expires_at.replace(tzinfo=None)
    now_naive = datetime.now(timezone.utc).replace(tzinfo=None)
    assert moved_set_expires <= now_naive

@pytest.mark.asyncio
async def test_teacher_deletion_resolves_conflicts(client, db_session, admin_teacher, target_teacher):
    # Create deleted_user with conflict titles
    deleted_user = Teacher(
        id=999999,
        username="deleted_user",
        email="deleted_user@deleted.invalid",
        is_active=False,
    )
    deleted_user.set_password("dummy")
    db_session.add(deleted_user)
    
    existing_task = Parsons(
        created_by_teacher_id=999999,
        title="Conflict Task",
        task_instructions='{"task_instructions": "Solve it"}',
        description='{"description": "A public task"}',
        task_type="parsons",
        code_blocks={},
        correct_solution={},
        is_public=True
    )
    db_session.add(existing_task)

    existing_set = TaskSet(
        teacher_id=999999,
        title="Conflict Set",
        unique_link_code="conflict-set",
        expires_at=None
    )
    db_session.add(existing_set)
    await db_session.commit()

    # Now create target teacher's task and set with conflicting details
    task = Parsons(
        created_by_teacher_id=target_teacher.id,
        title="Conflict Task",
        task_instructions='{"task_instructions": "Solve it"}',
        description='{"description": "A public task"}',
        task_type="parsons",
        code_blocks={},
        correct_solution={},
        is_public=True
    )
    db_session.add(task)

    task_set = TaskSet(
        teacher_id=target_teacher.id,
        title="Conflict Set",
        unique_link_code="conflict-set",
        expires_at=None
    )
    db_session.add(task_set)
    await db_session.commit()

    # Keep track of IDs
    task_id = task.id
    task_set_id = task_set.id
    target_teacher_id = target_teacher.id
    target_teacher_username = target_teacher.username

    # Call delete endpoint
    r = await client.request(
        "DELETE",
        f"/api/admin/users/teacher/{target_teacher_id}",
        headers=_auth(admin_teacher.username),
        json={"admin_password": "adminpassword123"}
    )
    assert r.status_code == 200

    # Verify resolved titles and codes
    db_session.expire_all()

    stmt = select(Parsons).where(Parsons.id == task_id)
    res = await db_session.execute(stmt)
    moved_task = res.scalar_one_or_none()
    assert moved_task is not None
    assert moved_task.title == f"Conflict Task ({target_teacher_username})"

    stmt = select(TaskSet).where(TaskSet.id == task_set_id)
    res = await db_session.execute(stmt)
    moved_set = res.scalar_one_or_none()
    assert moved_set is not None
    assert moved_set.title == f"Conflict Set ({target_teacher_username})"
    assert moved_set.unique_link_code == f"conflict-set-{target_teacher_username}"

@pytest.mark.asyncio
async def test_deleted_user_cannot_login(db_session, admin_teacher, target_teacher):
    # Create the deleted_user first
    deleted_user = Teacher(
        id=999999,
        username="deleted_user",
        email="deleted_user@deleted.invalid",
        is_active=False,
    )
    deleted_user.set_password("mypassword123")
    db_session.add(deleted_user)
    await db_session.commit()

    # Try to authenticate using authenticate_user
    authenticated = await authenticate_user("deleted@example.com", "mypassword123", db_session)
    assert authenticated is None

@pytest.mark.asyncio
async def test_teacher_deletion_fails_with_missing_password(client, admin_teacher, target_teacher):
    r = await client.delete(
        f"/api/admin/users/teacher/{target_teacher.id}",
        headers=_auth(admin_teacher.username)
    )
    assert r.status_code == 422

@pytest.mark.asyncio
async def test_teacher_deletion_fails_with_incorrect_password(client, admin_teacher, target_teacher):
    r = await client.request(
        "DELETE",
        f"/api/admin/users/teacher/{target_teacher.id}",
        headers=_auth(admin_teacher.username),
        json={"admin_password": "wrongpassword"}
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "Incorrect admin password"

@pytest.mark.asyncio
async def test_cannot_delete_deleted_user(client, admin_teacher):
    r = await client.request(
        "DELETE",
        "/api/admin/users/teacher/999999",
        headers=_auth(admin_teacher.username),
        json={"admin_password": "adminpassword123"}
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "Cannot delete the dummy deleted_user"

@pytest.mark.asyncio
async def test_cannot_delete_admin_teacher(client, db_session, admin_teacher):
    other_admin = Teacher(
        username="otheradmin_del",
        email="otheradmin_del@example.com",
        is_active=True,
        is_admin_teacher=True,
    )
    other_admin.set_password("otheradminpass")
    db_session.add(other_admin)
    await db_session.commit()
    await db_session.refresh(other_admin)

    r = await client.request(
        "DELETE",
        f"/api/admin/users/teacher/{other_admin.id}",
        headers=_auth(admin_teacher.username),
        json={"admin_password": "adminpassword123"}
    )
    assert r.status_code == 403
    assert r.json()["detail"] == "Cannot delete an admin teacher"

