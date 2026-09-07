"""Tests for database-backed task type tags."""

import pytest

from backend.models import Parsons, TaskType, Teacher
from backend.teacher_auth import create_access_token


def _auth(username: str) -> dict:
    return {"Authorization": f"Bearer {create_access_token({'sub': username})}"}


async def _make_admin(test_teacher, db_session) -> Teacher:
    test_teacher.is_admin_teacher = True
    await db_session.commit()
    return test_teacher


@pytest.mark.asyncio
async def test_teacher_can_list_only_active_task_types(client, db_session, test_teacher):
    db_session.add_all([
        TaskType(slug="functions", label="Functions", is_active=True),
        TaskType(slug="legacy", label="Legacy", is_active=False),
    ])
    await db_session.commit()

    response = await client.get("/api/task-types", headers=_auth(test_teacher.username))

    assert response.status_code == 200
    assert [item["slug"] for item in response.json()] == ["functions"]


@pytest.mark.asyncio
async def test_non_admin_cannot_create_task_type(client, test_teacher):
    response = await client.post(
        "/api/admin/task-types",
        headers=_auth(test_teacher.username),
        json={"label": "Recursion"},
    )

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_admin_can_create_update_and_deactivate_task_type(
    client, db_session, test_teacher
):
    await _make_admin(test_teacher, db_session)

    create_response = await client.post(
        "/api/admin/task-types",
        headers=_auth(test_teacher.username),
        json={"label": "  Error Handling  "},
    )

    assert create_response.status_code == 201
    created = create_response.json()
    assert created["slug"] == "error-handling"
    assert created["label"] == "Error Handling"

    update_response = await client.patch(
        f"/api/admin/task-types/{created['id']}",
        headers=_auth(test_teacher.username),
        json={"label": "Exceptions", "is_active": False},
    )

    assert update_response.status_code == 200
    assert update_response.json()["is_active"] is False
    assert update_response.json()["label"] == "Exceptions"
    assert update_response.json()["slug"] == created["slug"]

    active_response = await client.get(
        "/api/task-types", headers=_auth(test_teacher.username)
    )
    assert all(item["slug"] != "error-handling" for item in active_response.json())

    delete_response = await client.delete(
        f"/api/admin/task-types/{created['id']}",
        headers=_auth(test_teacher.username),
    )
    assert delete_response.status_code == 200
    assert delete_response.json()["is_active"] is False

    reactivate_response = await client.patch(
        f"/api/admin/task-types/{created['id']}",
        headers=_auth(test_teacher.username),
        json={"is_active": True},
    )
    assert reactivate_response.status_code == 200
    assert reactivate_response.json()["is_active"] is True

    reactivated_active_response = await client.get(
        "/api/task-types", headers=_auth(test_teacher.username)
    )
    assert any(item["slug"] == created["slug"] for item in reactivated_active_response.json())

    restored_task_response = await client.post(
        "/api/problems",
        headers=_auth(test_teacher.username),
        json={
            "taskTitle": "Restored tag task",
            "description": "This task can use the restored tag.",
            "startDescription": "Start here.",
            "tests": "assert restored_value() == 1",
            "solutionCode": "def restored_value():\n    return 1",
            "task_type": created["slug"],
        },
    )

    assert restored_task_response.status_code == 200
    restored_task = await db_session.get(Parsons, restored_task_response.json()["id"])
    assert restored_task.task_type == created["slug"]


@pytest.mark.asyncio
async def test_admin_task_type_list_includes_real_usage_counts(
    client, db_session, test_teacher
):
    await _make_admin(test_teacher, db_session)
    algorithms = TaskType(slug="algorithms", label="Algorithms", is_active=True)
    arithmetic = TaskType(slug="arithmetic", label="Arithmetic", is_active=False)
    db_session.add_all([
        algorithms,
        arithmetic,
        Parsons(
            created_by_teacher_id=test_teacher.id,
            title="Algorithms one",
            task_instructions="Instructions",
            task_type="algorithms",
            code_blocks={},
            correct_solution={},
        ),
        Parsons(
            created_by_teacher_id=test_teacher.id,
            title="Algorithms two",
            task_instructions="Instructions",
            task_type="ALGORITHMS",
            code_blocks={},
            correct_solution={},
        ),
        Parsons(
            created_by_teacher_id=test_teacher.id,
            title="Arithmetic one",
            task_instructions="Instructions",
            task_type="arithmetic",
            code_blocks={},
            correct_solution={},
        ),
    ])
    await db_session.commit()

    response = await client.get(
        "/api/admin/task-types", headers=_auth(test_teacher.username)
    )

    assert response.status_code == 200
    counts = {item["slug"]: item["task_count"] for item in response.json()}
    assert counts == {"algorithms": 2, "arithmetic": 1}


@pytest.mark.asyncio
async def test_new_task_type_is_accepted_when_creating_task(
    client, db_session, test_teacher
):
    db_session.add(TaskType(slug="recursion", label="Recursion", is_active=True))
    await db_session.commit()

    response = await client.post(
        "/api/problems",
        headers=_auth(test_teacher.username),
        json={
            "taskTitle": "Recursion Task",
            "description": "Practice recursion.",
            "startDescription": "Start here.",
            "tests": "assert recurse(1) == 1",
            "solutionCode": "def recurse(x):\n    return x",
            "task_type": "recursion",
        },
    )

    assert response.status_code == 200
    created = await db_session.get(Parsons, response.json()["id"])
    assert created.task_type == "recursion"


@pytest.mark.asyncio
async def test_deactivated_task_type_is_rejected_when_creating_task(
    client, db_session, test_teacher
):
    db_session.add(TaskType(slug="deactivated", label="Deactivated", is_active=False))
    await db_session.commit()

    response = await client.post(
        "/api/problems",
        headers=_auth(test_teacher.username),
        json={
            "taskTitle": "Deactivated tag task",
            "description": "This task should not be created.",
            "startDescription": "Start here.",
            "tests": "assert value() == 1",
            "solutionCode": "def value():\n    return 1",
            "task_type": "deactivated",
        },
    )

    assert response.status_code == 400
    assert "task_type must be one of" in response.json()["detail"]


@pytest.mark.asyncio
async def test_editing_legacy_task_without_tag_keeps_existing_value(
    client, db_session, test_teacher, task
):
    task.task_type = "python"
    await db_session.commit()

    response = await client.put(
        f"/api/problems/{task.id}",
        headers=_auth(test_teacher.username),
        json={
            "taskTitle": "Updated Legacy Task",
            "description": "Updated description.",
            "startDescription": "Updated start.",
            "tests": "assert updated_fn(1) == 2",
            "solutionCode": "def updated_fn(x):\n    return x + 1",
        },
    )

    assert response.status_code == 200
    await db_session.refresh(task)
    assert task.task_type == "python"
