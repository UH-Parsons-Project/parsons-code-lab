import io
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
    "userID", "starting time", "first attempt time", "event_type", "event_time",
    "block-id", "from_container", "to_container", "from_index", "to_index",
    "from_indent", "to_indent", "blank_index", "value",
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


def _safe_filename_part(value: str, fallback: str) -> str:
    safe = "".join(char if char.isalnum() or char in "-_" else "_" for char in (value or ""))
    return safe.strip("_") or fallback


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

    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for task, _ in task_rows:
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
                    .limit(1)
                )
                first_attempt = attempts_result.scalar_one_or_none()
                if not first_attempt:
                    continue

                sessions_result = await db.execute(
                    select(TaskSession)
                    .where(TaskSession.student_task_enrollment_id == enrollment.id)
                    .where(TaskSession.entered_at <= first_attempt.completed_at)
                    .order_by(TaskSession.entered_at.asc(), TaskSession.id.asc())
                )
                sessions = sessions_result.scalars().all()
                starting_time = _csv_datetime(sessions[0].entered_at if sessions else enrollment.started_at)
                first_attempt_time = _csv_datetime(first_attempt.completed_at)
                event_rows = []

                for session in sessions:
                    if session.id != sessions[0].id:
                        event_rows.append((session.entered_at, "return", ["", "", "", "", "", "", "", "", ""]))
                    if session.exited_at and session.exited_at <= first_attempt.completed_at:
                        event_rows.append((session.exited_at, "exit", ["", "", "", "", "", "", "", "", ""]))

                moves_result = await db.execute(
                    select(MoveEvent)
                    .where(MoveEvent.attempt_id == first_attempt.id)
                    .where(MoveEvent.event_time <= first_attempt.completed_at)
                )
                for move in moves_result.scalars().all():
                    event_rows.append((move.event_time, "move", [
                        move.block_id, move.from_container, move.to_container,
                        str(move.from_index), str(move.to_index), str(move.from_indent), str(move.to_indent), "", "",
                    ]))
                edits_result = await db.execute(
                    select(EditEvent)
                    .where(EditEvent.attempt_id == first_attempt.id)
                    .where(EditEvent.event_time <= first_attempt.completed_at)
                )
                for edit in edits_result.scalars().all():
                    event_rows.append((edit.event_time, "edit", [edit.block_id, "", "", "", "", "", "", str(edit.blank_index), edit.value]))

                for event_time, event_type, specific in sorted(event_rows, key=lambda event: (event[0], event[1])):
                    rows.append([
                        str(student.id), starting_time, first_attempt_time, event_type,
                        _csv_datetime(event_time), *specific,
                    ])

            filename = (
                f"{set_name}_{teacher_name}_{_safe_filename_part(task.title, 'task')}_"
                f"taskID_{task.id}_{generation_date}.csv"
            )
            zip_file.writestr(filename, _initial_events_csv(rows))

    archive.seek(0)
    zip_name = f"{set_name}_{teacher_name}_INITIAL_EVENTS_{generation_date}.zip"
    return Response(
        content=archive.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{zip_name}"'},
    )
