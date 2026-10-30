import csv
import io
import zipfile
from datetime import datetime

import pytest

from backend.models import (
    EditEvent,
    MoveEvent,
    Parsons,
    StudentTaskEnrollment,
    TaskSetItem,
    TaskAttempt,
    TaskSession,
    Teacher,
)
from backend.teacher_auth import create_access_token


@pytest.mark.parametrize("include_task_details", [False, None])
@pytest.mark.asyncio
async def test_initial_events_export_includes_attempts_through_first_success(
    client,
    db_session,
    test_teacher,
    task_set_with_task,
    student_session,
    include_task_details,
):
    task_set, task = task_set_with_task
    task.code_blocks = {
        "blocks": [
            {"code": "value = !BLANK", "indent": 0, "given": False},
            {"code": "print(value)", "indent": 0, "given": False},
        ]
    }
    task.correct_solution = {"eval_type": "unit_test"}
    enrollment = StudentTaskEnrollment(
        student_id=student_session.id,
        task_id=task.id,
        task_set_id=task_set.id,
        started_at=datetime(2026, 9, 11, 14, 0),
    )
    db_session.add(enrollment)
    await db_session.flush()
    session = TaskSession(
        student_task_enrollment_id=enrollment.id,
        entered_at=datetime(2026, 9, 11, 14, 0),
    )
    db_session.add(session)
    await db_session.flush()

    attempts = [
        TaskAttempt(
            student_id=student_session.id,
            task_id=task.id,
            student_task_enrollment_id=enrollment.id,
            task_session_id=session.id,
            completed_at=datetime(2026, 9, 11, 14, minute, 0),
            success=success,
        )
        for minute, success in ((2, False), (4, False), (6, True), (8, False))
    ]
    db_session.add_all(attempts)
    await db_session.flush()
    db_session.add_all([
        EditEvent(
            attempt_id=attempts[0].id,
            block_id="sortable-codeline0",
            blank_index=0,
            value="first",
            event_time=datetime(2026, 9, 11, 14, 1),
        ),
        MoveEvent(
            attempt_id=attempts[1].id,
            block_id="sortable-codeline1",
            from_container="starter",
            to_container="solution",
            from_index=0,
            to_index=1,
            from_indent=0,
            to_indent=1,
            event_time=datetime(2026, 9, 11, 14, 3),
        ),
        EditEvent(
            attempt_id=attempts[2].id,
            block_id="sortable-codeline0",
            blank_index=0,
            value="final",
            event_time=datetime(2026, 9, 11, 14, 5),
        ),
        EditEvent(
            attempt_id=attempts[3].id,
            block_id="sortable-codeline0",
            blank_index=0,
            value="after success",
            event_time=datetime(2026, 9, 11, 14, 7),
        ),
    ])
    await db_session.commit()

    token = create_access_token({"sub": test_teacher.username})
    payload = {"task_ids": [task.id]}
    if include_task_details is not None:
        payload["include_task_details"] = include_task_details
    response = await client.post(
        f"/api/my_sets/{task_set.id}/initial-events-export",
        headers={"Authorization": f"Bearer {token}"},
        json=payload,
    )

    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert len(archive.namelist()) == 1
        content = archive.read(archive.namelist()[0]).decode()
    lines = [line.split(" ; ") for line in content.splitlines()]
    headers = [value.strip() for value in lines[0]]
    rows = [dict(zip(headers, (value.strip() for value in line))) for line in lines[1:]]

    assert "starting_time" in headers
    assert "failed_attempt_count" in headers
    assert "failed_attempt_times" in headers
    assert "first_success_time" in headers
    assert "codeline_state" in headers
    assert "attempt_was_made_after_event" in headers
    assert "starting time" not in headers
    assert "first attempt time" not in headers
    assert len(rows) == 3
    assert {row["event_type"] for row in rows} == {"edit", "move"}
    assert all(row["failed_attempt_count"] == "2" for row in rows)
    assert all(
        row["failed_attempt_times"]
        == "2026-09-11T14:02:00.000000|2026-09-11T14:04:00.000000"
        for row in rows
    )
    assert all(row["first_success_time"] == "2026-09-11T14:06:00.000000" for row in rows)
    assert all(row["attempt_was_made_after_event"] == "True" for row in rows)
    assert next(row for row in rows if row["event_type"] == "move")["codeline_state"] == "print(value)"
    assert {
        row["codeline_state"] for row in rows if row["event_type"] == "edit"
    } == {"value = first", "value = final"}


@pytest.mark.asyncio
async def test_initial_events_export_includes_task_details_for_selected_tasks(
    client,
    db_session,
    test_teacher,
    task_set_with_task,
    student_session,
):
    task_set, task = task_set_with_task
    task.title = 'Task; "one"'
    task.code_blocks = {
        "blocks": [
            {
                "id": "block_1",
                "code": "value = ___",
                "indent": 0,
                "given": False,
                "faded": True,
            },
            {
                "id": "block_2",
                "code": 'print; "distractor" #blankteacher-only#',
                "indent": 0,
                "given": False,
                "faded": False,
            },
            {
                "id": "block_3",
                "code": "given solution",
                "indent": 0,
                "given": True,
                "faded": False,
            },
            {
                "id": "block_4",
                "code": "given distractor",
                "indent": 0,
                "given": True,
                "faded": True,
            },
        ]
    }
    task.correct_solution = {
        "eval_type": "unit_test",
        "correct_order": ["block_1", "block_3"],
    }

    order_only_task = Parsons(
        created_by_teacher_id=test_teacher.id,
        title="Order only",
        description="Order-only task",
        task_instructions="Arrange the blocks",
        task_type="python",
        code_blocks={
            "blocks": [
                {"id": "block_1", "code": "first", "given": False, "faded": False},
                {"id": "block_2", "code": "distractor", "given": False, "faded": True},
                {"id": "block_3", "code": "pre-placed", "given": True, "faded": False},
            ]
        },
        correct_solution={
            "eval_type": "order_only",
            "correct_order": ["block_1"],
        },
        is_public=True,
    )
    db_session.add(order_only_task)
    await db_session.flush()
    db_session.add(TaskSetItem(task_set_id=task_set.id, task_id=order_only_task.id))
    await db_session.commit()

    token = create_access_token({"sub": test_teacher.username})
    response = await client.post(
        f"/api/my_sets/{task_set.id}/initial-events-export",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "task_ids": [task.id, order_only_task.id],
            "include_task_details": True,
        },
    )

    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names = archive.namelist()
        details_name = "Week_1_Exercises_task-details.csv"
        assert details_name in names
        assert len(names) == 3
        event_names = [name for name in names if name != details_name]
        assert len(event_names) == 2
        assert all("taskID_" in name for name in event_names)
        assert all("userID" in archive.read(name).decode() for name in event_names)
        details_content = archive.read(details_name).decode()

    rows = list(csv.DictReader(io.StringIO(details_content), delimiter=";"))
    assert list(rows[0]) == [
        "task-id", "task-name", "block-id", "block-code", "solution-block", "faded",
    ]
    assert rows[0]["task-name"] == 'Task; "one"'
    assert rows[0]["block-code"] == "value = !BLANK"
    assert rows[0]["solution-block"] == "True"
    assert rows[0]["faded"] == "True"
    assert [row["block-id"] for row in rows[:8]] == [
        "sortable-codeline0",
        "sortable-codeline1",
        "sortable-codeline2",
        "sortable-codeline3",
        "sortable-codeline4",
        "sortable-codeline5",
        "sortable-codeline6",
        "sortable-codeline7",
    ]
    assert rows[1]["block-code"] == 'print; "distractor"'
    assert rows[1]["solution-block"] == "False"
    assert rows[2]["block-code"] == "print('DEBUG:', !BLANK)"
    assert rows[2]["solution-block"] == "False"
    assert rows[2]["faded"] == "True"
    assert rows[5]["block-code"] == "# !BLANK"
    assert rows[6]["block-code"] == "given solution"
    assert rows[6]["solution-block"] == "True"
    assert rows[7]["solution-block"] == "False"
    assert rows[7]["faded"] == "True"

    order_only_rows = rows[8:]
    assert [row["block-id"] for row in order_only_rows] == [
        "sortable-codeline0",
        "sortable-codeline1",
        "sortable-codeline2",
    ]
    assert all("DEBUG" not in row["block-code"] for row in order_only_rows)
    assert order_only_rows[0]["solution-block"] == "True"
    assert order_only_rows[1]["solution-block"] == "False"
    assert order_only_rows[1]["faded"] == "True"
    assert order_only_rows[2]["solution-block"] == "False"

    assert '"Task; ""one"""' in details_content
    assert '"print; ""distractor"""' in details_content


@pytest.mark.asyncio
async def test_initial_events_export_requires_task_set_access(
    client,
    db_session,
    task_set_with_task,
):
    task_set, task = task_set_with_task
    endpoint = f"/api/my_sets/{task_set.id}/initial-events-export"

    unauthorized = await client.post(endpoint, json={"task_ids": [task.id]})
    assert unauthorized.status_code == 401

    other_teacher = Teacher(
        username="otherteacher",
        email="other@example.com",
        is_active=True,
    )
    other_teacher.set_password("testpassword123")
    db_session.add(other_teacher)
    await db_session.commit()
    token = create_access_token({"sub": other_teacher.username})
    forbidden = await client.post(
        endpoint,
        headers={"Authorization": f"Bearer {token}"},
        json={"task_ids": [task.id]},
    )
    assert forbidden.status_code == 403
