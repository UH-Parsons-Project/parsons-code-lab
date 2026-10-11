from collections import defaultdict
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...database import get_db
from ...models import Parsons, Student, StudentTaskEnrollment, TaskAttempt, TaskSet, TaskSetItem
from ...pydantic import StudentTaskResponse
from ...student_auth import get_current_student_session, get_current_student_session_no_update
from ..utils.commons import get_task_set_by_code_or_404
from .student_task_context import resolve_task_context

router = APIRouter()


@router.get("/api/sets/{unique_link_code}/tasks/{task_id}", response_model=StudentTaskResponse)
async def get_task_for_student_set(
    task_id: int,
    unique_link_code: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    student_session: Annotated[Student | None, Depends(get_current_student_session_no_update)],
):
    if not student_session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Student session required")

    _, resolved_task_id = await resolve_task_context(db, unique_link_code, task_id)
    result = await db.execute(select(Parsons).where(Parsons.id == resolved_task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Task with id {resolved_task_id} not found")

    attempt_result = await db.execute(
        select(TaskAttempt)
        .where(
            (TaskAttempt.student_id == student_session.id)
            & (TaskAttempt.task_id == resolved_task_id)
            & TaskAttempt.success.is_(True)
        )
        .order_by(TaskAttempt.completed_at.desc())
        .limit(1)
    )
    attempt = attempt_result.scalar_one_or_none()
    submitted_order = getattr(attempt, "submitted_order", None) if attempt else None

    correct_solution = task.correct_solution if isinstance(task.correct_solution, dict) else {}
    student_correct_solution = {
        key: correct_solution[key]
        for key in ("teacher_tests", "custom_error_messages")
        if key in correct_solution
    }
    return StudentTaskResponse(
        id=task.id,
        title=task.title,
        task_instructions=task.task_instructions,
        description=task.description,
        task_type=task.task_type,
        code_blocks=task.code_blocks,
        correct_solution=student_correct_solution,
        is_public=task.is_public,
        faded=task.faded,
        created_at=task.created_at.isoformat(),
        submitted_order=submitted_order,
        eval_type=correct_solution.get("eval_type", "unit_test"),
        expected_output=correct_solution.get("expected_output", ""),
        correct_order=correct_solution.get("correct_order", []),
        require_indentation=correct_solution.get("require_indentation", True),
    )


@router.get("/api/sets/{unique_link_code}/tasks-status")
async def get_all_tasks_status(
    unique_link_code: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    student_session: Annotated[Student | None, Depends(get_current_student_session_no_update)],
):
    task_set = await get_task_set_by_code_or_404(db, TaskSet, unique_link_code)
    result = await db.execute(
        select(TaskSetItem.task_id)
        .where((TaskSetItem.task_set_id == task_set.id) & (TaskSetItem.is_hidden == False))
        .order_by(TaskSetItem.id.asc())
    )
    visible_task_ids = result.scalars().all()
    if not student_session:
        return [{"has_started": False, "student_attempts": 0, "student_completed": 0} for _ in visible_task_ids]
    if not visible_task_ids:
        return []

    enrollments = await db.execute(
        select(StudentTaskEnrollment.task_id).where(
            (StudentTaskEnrollment.student_id == student_session.id)
            & (StudentTaskEnrollment.task_set_id == task_set.id)
            & StudentTaskEnrollment.task_id.in_(visible_task_ids)
        )
    )
    started_task_ids = set(enrollments.scalars().all())
    attempts_result = await db.execute(
        select(TaskAttempt.task_id, TaskAttempt.success)
        .join(StudentTaskEnrollment, StudentTaskEnrollment.id == TaskAttempt.student_task_enrollment_id)
        .where(
            (TaskAttempt.student_id == student_session.id)
            & (StudentTaskEnrollment.task_set_id == task_set.id)
            & TaskAttempt.task_id.in_(visible_task_ids)
        )
    )
    attempts_by_task = defaultdict(lambda: {"attempts": 0, "completed": 0})
    for attempt in attempts_result.all():
        attempts_by_task[attempt.task_id]["attempts"] += 1
        attempts_by_task[attempt.task_id]["completed"] += int(attempt.success)

    return [
        {
            "has_started": task_id in started_task_ids,
            "student_attempts": attempts_by_task[task_id]["attempts"],
            "student_completed": attempts_by_task[task_id]["completed"],
        }
        for task_id in visible_task_ids
    ]


@router.get("/api/sets/{unique_link_code}/tasks/{task_id}/has-started")
async def check_task_has_started(
    task_id: int,
    unique_link_code: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    student_session: Annotated[Student | None, Depends(get_current_student_session)],
):
    if not student_session:
        return {"has_started": False}
    task_set, resolved_task_id = await resolve_task_context(db, unique_link_code, task_id)
    result = await db.execute(
        select(StudentTaskEnrollment).where(
            (StudentTaskEnrollment.student_id == student_session.id)
            & (StudentTaskEnrollment.task_id == resolved_task_id)
            & (StudentTaskEnrollment.task_set_id == task_set.id)
        )
    )
    return {"has_started": result.scalar_one_or_none() is not None}


@router.get("/api/sets/{unique_link_code}/tasks/{task_id}/my-completion-status")
async def get_my_completion_status(
    task_id: int,
    unique_link_code: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    student_session: Annotated[Student | None, Depends(get_current_student_session_no_update)],
):
    if not student_session:
        return {"student_attempts": 0, "student_completed": 0}
    task_set, resolved_task_id = await resolve_task_context(db, unique_link_code, task_id)
    result = await db.execute(
        select(TaskAttempt)
        .join(StudentTaskEnrollment, StudentTaskEnrollment.id == TaskAttempt.student_task_enrollment_id)
        .where(
            (TaskAttempt.student_id == student_session.id)
            & (TaskAttempt.task_id == resolved_task_id)
            & (StudentTaskEnrollment.task_set_id == task_set.id)
        )
    )
    attempts = result.scalars().all()
    return {
        "student_attempts": len(attempts),
        "student_completed": sum(1 for attempt in attempts if attempt.success),
    }