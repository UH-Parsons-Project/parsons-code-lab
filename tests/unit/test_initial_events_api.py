import io
import zipfile
from datetime import datetime

import pytest

from backend.models import (
    EditEvent,
    MoveEvent,
    StudentTaskEnrollment,
    TaskAttempt,
    TaskSession,
)
from backend.teacher_auth import create_access_token


@pytest.mark.asyncio
async def test_initial_events_export_includes_attempts_through_first_success(
    client,
    db_session,
    test_teacher,
    task_set_with_task,
    student_session,
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
            event_time=datetime(2026, 9, 11, 14, 2, 30),
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
    response = await client.post(
        f"/api/my_sets/{task_set.id}/initial-events-export",
        headers={"Authorization": f"Bearer {token}"},
        json={"task_ids": [task.id]},
    )

    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        content = archive.read(archive.namelist()[0]).decode()
    lines = [line.split(" ; ") for line in content.splitlines()]
    headers = [value.strip() for value in lines[0]]
    rows = [dict(zip(headers, (value.strip() for value in line))) for line in lines[1:]]

    assert "starting_time" in headers
    assert "total_failed_attempts" in headers
    assert "failed_attempt_times" in headers
    assert "first_success_time" in headers
    assert "codeline_state" in headers
    assert "attempt_was_made_after_event" in headers
    assert "starting time" not in headers
    assert "first attempt time" not in headers
    assert len(rows) == 3
    assert {row["event_type"] for row in rows} == {"edit", "move"}
    assert all(row["total_failed_attempts"] == "2" for row in rows)
    assert all(
        row["failed_attempt_times"]
        == "2026-09-11T14:02:00.000000|2026-09-11T14:04:00.000000"
        for row in rows
    )
    assert all(row["first_success_time"] == "2026-09-11T14:06:00.000000" for row in rows)
    assert next(row for row in rows if row["event_time"].startswith("2026-09-11T14:02:30"))[
        "attempt_was_made_after_event"
    ] == "False"
    assert all(
        row["attempt_was_made_after_event"] == "True"
        for row in rows
        if not row["event_time"].startswith("2026-09-11T14:02:30")
    )
    assert next(row for row in rows if row["event_type"] == "move")["codeline_state"] == "print(value)"
    assert {
        row["codeline_state"] for row in rows if row["event_type"] == "edit"
    } == {"value = first", "value = final"}
