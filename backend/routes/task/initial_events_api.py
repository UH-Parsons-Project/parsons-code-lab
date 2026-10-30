import csv
import io
import re
import zipfile
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...database import get_db
from ...teacher_auth import CurrentUser
from ...models import (
    EditEvent,
    MoveEvent,
    Parsons,
    Student,
    StudentTaskEnrollment,
    StudentTaskSetEnrollment,
    TaskAttempt,
    TaskSession,
    TaskSet,
    TaskSetItem,
    Teacher,
)
from ...pydantic import InitialEventsExportRequest
from ...utils.taskset import require_task_set_view_access
from ..utils.commons import get_task_set_or_404

router = APIRouter()

INITIAL_EVENTS_HEADERS = [
    "userID", "starting_time", "failed_attempt_count", "failed_attempt_times",
    "first_success_time", "event_type", "event_time", "block-id", "codeline_state",
    "from_container", "to_container", "from_index", "to_index",
    "from_indent", "to_indent", "blank_index", "value",
    "attempt_was_made_after_event",
]

TASK_DETAILS_HEADERS = [
    "task-id", "task-name", "block-id", "block-code", "solution-block", "faded",
]


def _csv_datetime(value: datetime | None) -> str:
    return value.isoformat(timespec="microseconds") if value else ""


def _initial_events_csv(rows: list[list[str]]) -> str:
    all_rows = [INITIAL_EVENTS_HEADERS, *rows]
    widths = [
        max(len(str(row[column_index] or "")) for row in all_rows)
        for column_index in range(len(INITIAL_EVENTS_HEADERS))
    ]

    return "\n".join(
        " ; ".join(
            str(cell or "").ljust(widths[column_index])
            for column_index, cell in enumerate(row)
        )
        for row in all_rows
    )


def _task_details_csv(rows: list[list[object]]) -> str:
    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter=";", lineterminator="\n")
    writer.writerow(TASK_DETAILS_HEADERS)
    writer.writerows(rows)
    return output.getvalue()


def _safe_filename_part(value: str, fallback: str) -> str:
    safe = "".join(char if char.isalnum() or char in "-_" else "_" for char in (value or ""))
    return safe.strip("_") or fallback


def _task_codeline_details(task: Parsons) -> list[dict]:
    blocks = (task.code_blocks or {}).get("blocks", [])
    eval_type = (task.correct_solution or {}).get("eval_type", "unit_test")
    solution_block_ids = {
        str(block_id)
        for block_id in (task.correct_solution or {}).get("correct_order") or []
    }

    def is_given(block: dict | str) -> bool:
        return isinstance(block, dict) and block.get("given", False)

    def clean_code(block: dict | str) -> str:
        code = str((block.get("code", "") or "") if isinstance(block, dict) else block or "")
        code = re.sub(r"#blank[^#]*#", "", code)
        code = re.sub(r"\s*#preplace\b", "", code)
        code = re.sub(
            r"<input[^>]*>(?:</input>)?",
            "!BLANK",
            code,
            flags=re.IGNORECASE,
        )
        code = re.sub(r"<input[^>]*/>", "!BLANK", code, flags=re.IGNORECASE)
        code = re.sub(r"<[^>]+>", "", code)
        return code.replace("___", "!BLANK").strip()

    details = []
    line_index = 0

    def add_block(block: dict | str, block_index: int | None = None, synthetic: bool = False):
        nonlocal line_index
        if synthetic:
            code = str(block)
            solution_block = False
            faded = True
        else:
            code = clean_code(block)
            stored_block_id = (
                str(block.get("id") or f"block_{block_index + 1}")
                if isinstance(block, dict) and block_index is not None
                else f"block_{(block_index or 0) + 1}"
            )
            solution_block = stored_block_id in solution_block_ids
            faded = bool(block.get("faded", False)) if isinstance(block, dict) else False

        details.append({
            "block-id": f"sortable-codeline{line_index}",
            "block-code": code,
            "solution-block": solution_block,
            "faded": faded,
        })
        line_index += 1

    for block_index, block in enumerate(blocks):
        if not is_given(block):
            add_block(block, block_index)

    if eval_type != "order_only":
        for code in (
            "print('DEBUG:', !BLANK)",
            "print('DEBUG:', !BLANK)",
            "# !BLANK",
            "# !BLANK",
        ):
            add_block(code, synthetic=True)

    for block_index, block in enumerate(blocks):
        if is_given(block):
            add_block(block, block_index)
    return details


def _task_codelines(task: Parsons) -> dict[str, str]:
    return {
        detail["block-id"]: detail["block-code"]
        for detail in _task_codeline_details(task)
    }


def _task_details_rows(task: Parsons) -> list[list[object]]:
    return [
        [
            task.id,
            task.title,
            detail["block-id"],
            detail["block-code"],
            str(detail["solution-block"]),
            str(detail["faded"]),
        ]
        for detail in _task_codeline_details(task)
    ]


def _codeline_state(code: str, blank_values: dict[int, str]) -> str:
    parts = code.split("!BLANK")
    state = parts[0]
    for blank_index, part in enumerate(parts[1:]):
        state += blank_values.get(blank_index, "") + part
    return state


@router.post("/api/my_sets/{task_set_id}/initial-events-export")
async def export_initial_events(
    task_set_id: int,
    request: InitialEventsExportRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    task_set = await get_task_set_or_404(db, TaskSet, task_set_id)
    await require_task_set_view_access(task_set, current_user, db)

    requested_ids = list(dict.fromkeys(request.task_ids))
    if not requested_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Select at least one task")

    tasks_result = await db.execute(
        select(Parsons, TaskSetItem.id)
        .join(TaskSetItem, TaskSetItem.task_id == Parsons.id)
        .where(TaskSetItem.task_set_id == task_set_id, Parsons.id.in_(requested_ids))
        .order_by(TaskSetItem.id.asc())
    )
    task_rows = tasks_result.all()
    if len(task_rows) != len(requested_ids):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="One or more tasks are not in this task set")

    teacher = await db.get(Teacher, task_set.teacher_id)
    students_result = await db.execute(
        select(Student, StudentTaskSetEnrollment.enrolled_at)
        .join(StudentTaskSetEnrollment, StudentTaskSetEnrollment.student_id == Student.id)
        .where(StudentTaskSetEnrollment.task_set_id == task_set_id)
        .order_by(Student.id.asc())
    )
    students = students_result.all()
    archive = io.BytesIO()
    generation_date = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    set_name = _safe_filename_part(task_set.title, "taskSet")
    teacher_name = _safe_filename_part(teacher.username if teacher else "teacher", "teacher")
    task_details_rows = []

    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for task, _ in task_rows:
            if request.include_task_details:
                task_details_rows.extend(_task_details_rows(task))
            student_ids = [student.id for student, _ in students]
            enrollment_result = await db.execute(
                select(StudentTaskEnrollment)
                .where(
                    StudentTaskEnrollment.task_set_id == task_set_id,
                    StudentTaskEnrollment.task_id == task.id,
                    StudentTaskEnrollment.student_id.in_(student_ids),
                )
            ) if student_ids else None
            enrollments = enrollment_result.scalars().all() if enrollment_result else []
            enrollment_by_student = {enrollment.student_id: enrollment for enrollment in enrollments}
            rows = []

            for student, _ in students:
                enrollment = enrollment_by_student.get(student.id)
                if not enrollment:
                    continue
                attempts_result = await db.execute(
                    select(TaskAttempt)
                    .where(TaskAttempt.student_task_enrollment_id == enrollment.id)
                    .where(TaskAttempt.completed_at.isnot(None))
                    .order_by(TaskAttempt.completed_at.asc(), TaskAttempt.id.asc())
                )
                attempts = attempts_result.scalars().all()
                if not attempts:
                    continue

                first_success_index = next(
                    (index for index, attempt in enumerate(attempts) if attempt.success is True),
                    None,
                )
                attempts_through_success = (
                    attempts[: first_success_index + 1]
                    if first_success_index is not None
                    else attempts
                )
                first_success = (
                    attempts[first_success_index]
                    if first_success_index is not None
                    else None
                )
                last_attempt_time = attempts_through_success[-1].completed_at
                first_success_time = _csv_datetime(
                    first_success.completed_at if first_success else None
                )
                failed_attempts = [
                    attempt for attempt in attempts_through_success
                    if attempt.success is False
                ]

                sessions_result = await db.execute(
                    select(TaskSession)
                    .where(TaskSession.student_task_enrollment_id == enrollment.id)
                    .where(TaskSession.entered_at <= last_attempt_time)
                    .order_by(TaskSession.entered_at.asc(), TaskSession.id.asc())
                )
                sessions = sessions_result.scalars().all()
                starting_time = _csv_datetime(sessions[0].entered_at if sessions else enrollment.started_at)
                event_rows = []

                for session in sessions:
                    if session.id != sessions[0].id:
                        event_rows.append((session.entered_at, "return", None))
                    if session.exited_at and session.exited_at <= last_attempt_time:
                        event_rows.append((session.exited_at, "exit", None))

                attempt_ids = [attempt.id for attempt in attempts_through_success]
                moves_result = await db.execute(
                    select(MoveEvent)
                    .where(MoveEvent.attempt_id.in_(attempt_ids))
                    .where(MoveEvent.event_time <= last_attempt_time)
                )
                for move in moves_result.scalars().all():
                    event_rows.append((move.event_time, "move", move))
                edits_result = await db.execute(
                    select(EditEvent)
                    .where(EditEvent.attempt_id.in_(attempt_ids))
                    .where(EditEvent.event_time <= last_attempt_time)
                )
                for edit in edits_result.scalars().all():
                    event_rows.append((edit.event_time, "edit", edit))

                codelines = _task_codelines(task)
                blank_values: dict[str, dict[int, str]] = {}
                attempt_times = [attempt.completed_at for attempt in attempts_through_success]
                export_context = [
                    str(student.id),
                    starting_time,
                    str(len(failed_attempts)),
                    "|".join(_csv_datetime(attempt.completed_at) for attempt in failed_attempts),
                    first_success_time,
                ]

                for event_time, event_type, event in sorted(
                    event_rows, key=lambda item: (item[0], item[1])
                ):
                    block_id = ""
                    state = ""
                    specific = ["", "", "", "", "", "", "", ""]
                    if event_type == "move":
                        block_id = event.block_id
                        specific = [
                            event.from_container, event.to_container,
                            str(event.from_index), str(event.to_index),
                            str(event.from_indent), str(event.to_indent), "", "",
                        ]
                    elif event_type == "edit":
                        block_id = event.block_id
                        blank_values.setdefault(block_id, {})[event.blank_index] = event.value
                        specific = ["", "", "", "", "", "", str(event.blank_index), event.value]

                    if block_id in codelines:
                        state = _codeline_state(
                            codelines[block_id],
                            blank_values.get(block_id, {}),
                        )

                    attempt_was_made_after_event = any(
                        attempt_time >= event_time for attempt_time in attempt_times
                    )
                    rows.append([
                        *export_context, event_type, _csv_datetime(event_time),
                        block_id, state, *specific,
                        str(attempt_was_made_after_event),
                    ])

            filename = (
                f"{set_name}_{teacher_name}_{_safe_filename_part(task.title, 'task')}_"
                f"taskID_{task.id}_{generation_date}.csv"
            )
            zip_file.writestr(filename, _initial_events_csv(rows))

        if request.include_task_details:
            zip_file.writestr(
                f"{set_name}_task-details.csv",
                _task_details_csv(task_details_rows),
            )

    archive.seek(0)
    zip_name = f"{set_name}_{teacher_name}_INITIAL_EVENTS_{generation_date}.zip"
    return Response(
        content=archive.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{zip_name}"'},
    )
