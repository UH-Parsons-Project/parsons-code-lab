# pylint: disable=unused-variable
import json
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import Integer, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.utils import _clean_mistake_code, _mistake_code_fingerprint, has_user_added_own_code

from ...teacher_auth import CurrentUser
from ...database import get_db
from ...models import (
    EditEvent,
    ModelAnswer,
    MoveEvent,
    Parsons,
    Student,
    StudentTaskEnrollment,
    StudentTaskSetEnrollment,
    TaskAttempt,
    TaskSession,
    TaskSet,
    TaskSetItem,
)
from ...pydantic import (
    StudentTaskAttemptResponse,
    StudentTaskStatisticsResponse,
)
from ...utils.taskset import can_view_task_in_task_set, has_task_set_view_access, require_task_set_view_access
from ..utils.commons import get_task_set_or_404, run_with_task_ids_or_empty

def _active_time_to(sessions: list[TaskSession], target_dt: datetime | None) -> float | None:
    if not target_dt or not sessions:
        return None
    target_dt_naive = target_dt.replace(tzinfo=None)
    total = 0.0
    for s in sessions:
        s_entered = s.entered_at.replace(tzinfo=None)
        if s_entered >= target_dt_naive:
            break
        s_exited = s.exited_at.replace(tzinfo=None) if s.exited_at else target_dt_naive
        end = min(s_exited, target_dt_naive)
        total += (end - s_entered).total_seconds()
    return total if total > 0 else None


def _filter_empty_attempts(attempts_data: list, task: Parsons) -> tuple[list, int]:
    filtered = []
    empty_count = 0
    for attempt, enrollment in attempts_data:
        if not (attempt.submitted_inputs and isinstance(attempt.submitted_inputs, dict)):
            filtered.append((attempt, enrollment))
            continue
        code = attempt.submitted_inputs.get("code", "")
        if not code:
            filtered.append((attempt, enrollment))
        elif has_user_added_own_code(code, task.code_blocks):
            filtered.append((attempt, enrollment))
        else:
            empty_count += 1
    return filtered, empty_count

router = APIRouter()


def compute_box_stats(values: list) -> dict | None:
    if not values:
        return None
    n = len(values)
    sv = sorted(values)

    def pct(p):
        k = (n - 1) * p / 100.0
        lo, hi = int(k), min(int(k) + 1, n - 1)
        return sv[lo] + (k - lo) * (sv[hi] - sv[lo])

    q1, med, q3 = pct(25), pct(50), pct(75)
    iqr = q3 - q1
    wl = min(v for v in sv if v >= q1 - 1.5 * iqr)
    wh = max(v for v in sv if v <= q3 + 1.5 * iqr)
    outliers = [v for v in sv if v < q1 - 1.5 * iqr or v > q3 + 1.5 * iqr]

    return {
        "count": n,
        "avg": round(sum(values) / n, 2),
        "min": round(sv[0], 2),
        "max": round(sv[-1], 2),
        "q1": round(q1, 2),
        "median": round(med, 2),
        "q3": round(q3, 2),
        "whisker_low": round(wl, 2),
        "whisker_high": round(wh, 2),
        "outliers": [round(v, 2) for v in outliers],
    }


async def _get_model_answer_for_task(task: Parsons, db: AsyncSession) -> str | None:
    result = await db.execute(
        select(ModelAnswer.answer_code).where(ModelAnswer.parsons_id == task.id)
    )
    return result.scalar_one_or_none()


def _parse_custom_error_messages(task: Parsons) -> list:
    raw = task.correct_solution.get("custom_error_messages")
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


# use shared helpers from utils.taskset


@router.get("/api/students/{student_id}/attempts", response_model=list[StudentTaskAttemptResponse])
async def get_student_attempts(
    student_id: int,
    set_id: int,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)]
):
    task_set = await get_task_set_or_404(db, TaskSet, set_id)

    student_username_res = await db.execute(select(Student.id, Student.username).where(Student.id == student_id))
    student_username = student_username_res.scalar_one_or_none() or "Unknown"
    await require_task_set_view_access(task_set, current_user, db)

    task_ids_stmt = select(TaskSetItem.task_id).where(TaskSetItem.task_set_id == set_id)

    async def _handler(task_ids):

        stmt = (
            select(
                Parsons.id,
                Parsons.title,
                Parsons.task_type,
                func.count(TaskAttempt.id).label('attempts'),  # pylint: disable=not-callable
                func.coalesce(func.sum(func.cast(TaskAttempt.success, Integer)), 0).label('success_count'),  # pylint: disable=not-callable
                func.max(TaskAttempt.completed_at).label('last_attempt_at'),
                func.max(case((StudentTaskEnrollment.id.isnot(None), 1), else_=0)).label('has_started')
            )
            .join(TaskSetItem, (TaskSetItem.task_id == Parsons.id) & (TaskSetItem.task_set_id == set_id))
            .outerjoin(
                StudentTaskEnrollment,
                (StudentTaskEnrollment.task_id == Parsons.id)
                & (StudentTaskEnrollment.task_set_id == set_id)
                & (StudentTaskEnrollment.student_id == student_id)
            )
            .outerjoin(
                TaskAttempt,
                (TaskAttempt.task_id == Parsons.id)
                & (TaskAttempt.student_task_enrollment_id == StudentTaskEnrollment.id)
            )
            .where(Parsons.id.in_(task_ids))
            .group_by(Parsons.id, Parsons.title, Parsons.task_type, TaskSetItem.id)
            .order_by(TaskSetItem.id.asc())
        )

        result = await db.execute(stmt)
        attempts = result.all()

        return [
            StudentTaskAttemptResponse(
                task_id=attempt.id,
                task_title=attempt.title,
                task_type=attempt.task_type,
                attempts=attempt.attempts,
                success_count=attempt.success_count or 0,
                last_attempt_at=attempt.last_attempt_at.isoformat() if attempt.last_attempt_at else "",
                has_started=bool(attempt.has_started)
            )
            for attempt in attempts
        ]

    return await run_with_task_ids_or_empty(db, task_ids_stmt, _handler)



@router.get("/api/students/{student_id}/tasks/{task_id}/statistics", response_model=StudentTaskStatisticsResponse)
async def get_student_task_statistics(
    student_id: int,
    task_id: int,
    set_id: int,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)]
):
    task_set = await get_task_set_or_404(db, TaskSet, set_id)

    student_username_res = await db.execute(select(Student.username).where(Student.id == student_id))
    student_username = student_username_res.scalar_one_or_none() or "Unknown"
    await require_task_set_view_access(task_set, current_user, db)

    task_result = await db.execute(select(Parsons).where(Parsons.id == task_id))
    task = task_result.scalar_one_or_none()

    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task with id {task_id} not found"
        )

    if not await can_view_task_in_task_set(task, task_set, current_user, db):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task with id {task_id} not found"
        )

    stmt = (
        select(TaskAttempt, StudentTaskEnrollment)
        .join(Student, Student.id == TaskAttempt.student_id)
        .join(StudentTaskEnrollment, StudentTaskEnrollment.id == TaskAttempt.student_task_enrollment_id)
        .where(Student.id == student_id)
        .where(TaskAttempt.task_id == task_id)
        .where(StudentTaskEnrollment.task_set_id == task_set.id)
        .order_by(TaskAttempt.completed_at.asc())
    )

    result = await db.execute(stmt)
    attempts_with_enrollments = result.all()

    # Compute thinking time: time between StudentTaskEnrollment.started_at and first move/edit event
    enrollment_stmt = (
        select(StudentTaskEnrollment)
        .join(Student, Student.id == StudentTaskEnrollment.student_id)
        .where(Student.id == student_id)
        .where(StudentTaskEnrollment.task_id == task_id)
        .where(StudentTaskEnrollment.task_set_id == task_set.id)
    )
    enrollment_result = await db.execute(enrollment_stmt)
    enrollment_record = enrollment_result.scalar_one_or_none()

    thinking_time = None
    thinking_time_on_page = None

    attempts_data, empty_attempts_count = _filter_empty_attempts(list(attempts_with_enrollments), task)

    # Count only block move events (not blank edits)
    move_count_stmt = (
        select(func.count(MoveEvent.id))  # pylint: disable=not-callable
        .join(TaskAttempt, TaskAttempt.id == MoveEvent.attempt_id)
        .join(Student, Student.id == TaskAttempt.student_id)
        .where(Student.id == student_id)
        .where(TaskAttempt.task_id == task_id)
    )
    move_count = (await db.execute(move_count_stmt)).scalar() or 0

    # Fetch all sessions for this student+task
    sessions_data = []
    total_time_seconds = None
    task_sessions = []
    if enrollment_record:
        sessions_stmt = (
            select(TaskSession)
            .where(TaskSession.student_task_enrollment_id == enrollment_record.id)
            .order_by(TaskSession.entered_at.asc())
        )
        sessions_result = await db.execute(sessions_stmt)
        task_sessions = sessions_result.scalars().all()
        total_secs = 0.0
        for s in task_sessions:
            duration = None
            if s.exited_at:
                duration = (s.exited_at - s.entered_at).total_seconds()
                total_secs += duration
            sessions_data.append({
                "entered_at": s.entered_at.isoformat(),
                "exited_at": s.exited_at.isoformat() if s.exited_at else None,
                "exit_reason": s.exit_reason,
                "duration_seconds": duration,
            })
        if total_secs > 0:
            total_time_seconds = total_secs

        # Now compute thinking times
        if enrollment_record.started_at:
            first_move_stmt = (
                select(func.min(MoveEvent.event_time))
                .join(TaskAttempt, TaskAttempt.id == MoveEvent.attempt_id)
                .join(Student, Student.id == TaskAttempt.student_id)
                .where(Student.id == student_id)
                .where(TaskAttempt.task_id == task_id)
            )
            first_edit_stmt = (
                select(func.min(EditEvent.event_time))
                .join(TaskAttempt, TaskAttempt.id == EditEvent.attempt_id)
                .join(Student, Student.id == TaskAttempt.student_id)
                .where(Student.id == student_id)
                .where(TaskAttempt.task_id == task_id)
            )
            first_move_time = (await db.execute(first_move_stmt)).scalar()
            first_edit_time = (await db.execute(first_edit_stmt)).scalar()

            candidates = [t for t in [first_move_time, first_edit_time] if t is not None]
            if candidates:
                first_event_time = min(candidates)
                # Normalize to naive
                started_at_naive = enrollment_record.started_at.replace(tzinfo=None)
                first_event_time_naive = first_event_time.replace(tzinfo=None)
                seconds = (first_event_time_naive - started_at_naive).total_seconds()
                if seconds >= 0:
                    thinking_time = {"seconds": seconds}

                    on_page_secs = 0.0
                    for s in task_sessions:
                        s_entered = s.entered_at.replace(tzinfo=None)
                        if s_entered >= first_event_time_naive:
                            break
                        s_exited = s.exited_at.replace(tzinfo=None) if s.exited_at else first_event_time_naive
                        start = max(s_entered, started_at_naive)
                        end = min(s_exited, first_event_time_naive)
                        if end > start:
                            on_page_secs += (end - start).total_seconds()
                    thinking_time_on_page = {"seconds": on_page_secs}

    student_page_exits = float(max(0, len(task_sessions) - 1)) if task_sessions else 0.0

    if not attempts_data:
        return StudentTaskStatisticsResponse(
            task_name=task.title,
            task_description=task.description,
            task_instructions=task.task_instructions,
            model_answer=await _get_model_answer_for_task(task, db),
            student_id=student_id, student_username=student_username,
            total_attempts=0,
            successful_attempts=0,
            failed_attempts=0,
            empty_attempts=0,
            time_to_first_success=None,
            time_to_first_success_on_page=None,
            time_to_first_fail=None,
            time_to_first_fail_on_page=None,
            thinking_time=thinking_time,
            thinking_time_on_page=thinking_time_on_page,
            move_count=move_count,
            attempts_detail=[],
            total_time_seconds=total_time_seconds,
            sessions=sessions_data,
            task_set_name=task_set.title,
            task_set_code=task_set.unique_link_code,
            median_page_exits=student_page_exits,
        )

    successful_attempts = sum(1 for a, _ in attempts_data if a.success)
    failed_attempts = sum(1 for a, _ in attempts_data if not a.success)

    def active_time_to(target_dt):
        """Sum session durations up to target_dt (active page time only)."""
        return _active_time_to(task_sessions, target_dt)

    time_to_first_success = None
    time_to_first_success_on_page = None
    first_success_pair = next(((a, en) for a, en in attempts_data if a.success), None)
    if first_success_pair:
        attempt, _ = first_success_pair
        if attempt.completed_at and enrollment_record and enrollment_record.started_at:
            attempt_completed_naive = attempt.completed_at.replace(tzinfo=None)
            started_at_naive = enrollment_record.started_at.replace(tzinfo=None)
            secs_wall = (attempt_completed_naive - started_at_naive).total_seconds()
            if secs_wall >= 0:
                time_to_first_success = {"seconds": secs_wall}
            secs_active = active_time_to(attempt.completed_at)
            if secs_active is not None:
                time_to_first_success_on_page = {"seconds": secs_active}

    first_fail_pair = next(((a, en) for a, en in attempts_data if not a.success), None)
    time_to_first_fail = None
    time_to_first_fail_on_page = None
    if first_fail_pair:
        attempt, _ = first_fail_pair
        if attempt.completed_at and enrollment_record and enrollment_record.started_at:
            attempt_completed_naive = attempt.completed_at.replace(tzinfo=None)
            started_at_naive = enrollment_record.started_at.replace(tzinfo=None)
            secs_wall = (attempt_completed_naive - started_at_naive).total_seconds()
            if secs_wall >= 0:
                time_to_first_fail = {"seconds": secs_wall}
            secs_active = active_time_to(attempt.completed_at)
            if secs_active is not None:
                time_to_first_fail_on_page = {"seconds": secs_active}

    attempts_detail = []
    for i, (attempt, enrollment) in enumerate(attempts_data, 1):
        time_taken = active_time_to(attempt.completed_at) \
            if attempt.completed_at else None
        detail = {
            "attempt_number": i,
            "success": attempt.success,
            "completed_at": attempt.completed_at.isoformat() if attempt.completed_at else None,
            "time_taken": time_taken,
            "code": attempt.submitted_inputs.get("code") if attempt.submitted_inputs else None,
        }
        attempts_detail.append(detail)

    return StudentTaskStatisticsResponse(
        task_name=task.title,
        task_description=task.description,
        task_instructions=task.task_instructions,
        model_answer=await _get_model_answer_for_task(task, db),
        student_id=student_id, student_username=student_username,
        total_attempts=len(attempts_data),
        successful_attempts=successful_attempts,
        failed_attempts=failed_attempts,
        empty_attempts=empty_attempts_count,
        time_to_first_success=time_to_first_success,
        time_to_first_success_on_page=time_to_first_success_on_page,
        time_to_first_fail=time_to_first_fail,
        time_to_first_fail_on_page=time_to_first_fail_on_page,
        thinking_time=thinking_time,
        thinking_time_on_page=thinking_time_on_page,
        move_count=move_count,
        attempts_detail=attempts_detail,
        total_time_seconds=total_time_seconds,
        sessions=sessions_data,
        task_set_name=task_set.title,
        task_set_code=task_set.unique_link_code,
        median_page_exits=student_page_exits,
    )


@router.get("/api/tasksets/{task_set_code}/tasks/statistics")
async def get_taskset_tasks_statistics(
    task_set_code: str,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)]
):
    task_set_result = await db.execute(select(TaskSet).where(TaskSet.unique_link_code == task_set_code))
    task_set = task_set_result.scalar_one_or_none()
    if not task_set:
        raise HTTPException(status_code=404, detail="Not found")

    await require_task_set_view_access(task_set, current_user, db)

    stmt = select(TaskSetItem.task_id).where(
        (TaskSetItem.task_set_id == task_set.id) &
        (TaskSetItem.is_hidden == False)
    )
    task_ids = (await db.execute(stmt)).scalars().all()

    results = {}
    for t_id in task_ids:
        try:
            stats = await get_task_statistics(t_id, current_user, db, task_set_code)
            results[str(t_id)] = stats
        except Exception:
            pass
    return results


@router.get("/api/tasks/{task_id}/statistics")
async def get_task_statistics(
    task_id: int,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    task_set_code: str | None = None,
):
    task_result = await db.execute(select(Parsons).where(Parsons.id == task_id))
    task = task_result.scalar_one_or_none()

    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task with id {task_id} not found"
        )

    if not task_set_code and not task.is_public and task.created_by_teacher_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task with id {task_id} not found"
        )

    task_set = None
    attempts_query = (
        select(TaskAttempt, StudentTaskEnrollment)
        .join(StudentTaskEnrollment, StudentTaskEnrollment.id == TaskAttempt.student_task_enrollment_id)
        .where(TaskAttempt.task_id == task_id)
    )

    if task_set_code:
        task_set_result = await db.execute(
            select(TaskSet).where(TaskSet.unique_link_code == task_set_code)
        )
        task_set = task_set_result.scalar_one_or_none()

        if not task_set:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Problem set '{task_set_code}' not found",
            )

        await require_task_set_view_access(task_set, current_user, db)

        if not await can_view_task_in_task_set(task, task_set, current_user, db):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Task with id {task_id} not found"
            )

        attempts_query = (
            select(TaskAttempt, StudentTaskEnrollment)
            .join(StudentTaskEnrollment, StudentTaskEnrollment.id == TaskAttempt.student_task_enrollment_id)
            .where(
                TaskAttempt.task_id == task_id,
                StudentTaskEnrollment.task_set_id == task_set.id
            )
        )

    attempts_result = await db.execute(attempts_query)
    attempts_data = attempts_result.all()

    attempts_data, _ = _filter_empty_attempts(attempts_data, task)

    if not attempts_data:
        early_not_started = 0
        early_started = 0
        early_not_started_names: list[dict] = []
        if task_set_code and task_set:
            enrolled_result = await db.execute(
                select(Student.id, Student.username)
                .join(StudentTaskSetEnrollment, StudentTaskSetEnrollment.student_id == Student.id)
                .where(StudentTaskSetEnrollment.task_set_id == task_set.id)
            )
            enrolled_students = {row[0]: row[1] for row in enrolled_result.all()}

            started_result = await db.execute(
                select(StudentTaskEnrollment.student_id)
                .where(
                    StudentTaskEnrollment.task_set_id == task_set.id,
                    StudentTaskEnrollment.task_id == task.id
                )
            )
            started_ids = set(started_result.scalars().all())
            not_started_ids = set(enrolled_students.keys()) - started_ids
            early_not_started = len(not_started_ids)
            early_started = len(started_ids)
            early_not_started_names = sorted([{"name": enrolled_students[i], "meta": "", "id": i} for i in not_started_ids], key=lambda x: x["name"])
        return {
            "task_name": task.title,
            "is_public": task.is_public,
            "task_set_name": task_set.title if task_set_code and task_set else None,
            "model_answer": await _get_model_answer_for_task(task, db),
            "custom_error_messages": _parse_custom_error_messages(task),
            "total_completions": 0,
            "students_attempted": early_started,
            "students_completed": 0,
            "students_not_started": early_not_started,
            "avg_tries": 0,
            "time_to_first_fail": None,
            "time_to_first_fail_on_page": None,
            "time_to_first_success": None,
            "time_to_first_success_on_page": None,
            "thinking_time": None,
            "thinking_time_on_page": None,
            "number_of_moves": None,
            "common_mistakes": [],
            "students": {
                "completed": [],
                "not_yet_completed": [],
                "not_started": [{"name": n_username, "meta": "", "id": n_id} for n_id, n_username in early_not_started_names],
            },
            "median_page_exits": 0.0,
            "min_page_exits": None,
            "max_page_exits": None,
            "avg_page_exits": 0.0,
        }

    successful_attempts = [(a, ts) for a, ts in attempts_data if a.success]
    failed_attempts = [(a, ts) for a, ts in attempts_data if not a.success]

    students_attempted = len(set(a.student_id for a, _ in attempts_data))
    students_completed = len(set(a.student_id for a, _ in successful_attempts))

    # Fetch all sessions for this task, grouped by student_task_enrollment_id
    enrollment_ids = list({en.id for _, en in attempts_data})
    sessions_result = await db.execute(
        select(TaskSession)
        .where(TaskSession.student_task_enrollment_id.in_(enrollment_ids))
        .order_by(TaskSession.entered_at.asc())
    )
    all_sessions = sessions_result.scalars().all()
    sessions_by_enrollment: dict = {}
    for s in all_sessions:
        sessions_by_enrollment.setdefault(s.student_task_enrollment_id, []).append(s)

    def active_time_to(enrollment_id, target_dt):
        """Sum session durations up to target_dt for a given enrollment."""
        return _active_time_to(sessions_by_enrollment.get(enrollment_id, []), target_dt)

    student_attempts: dict = {}
    for attempt, enrollment in attempts_data:
        student_attempts.setdefault(attempt.student_id, []).append((attempt, enrollment))

    tries_before_success = []
    for session_attempts in student_attempts.values():
        sorted_attempts = sorted(
            session_attempts,
            key=lambda pair: pair[0].completed_at.replace(tzinfo=None) if pair[0].completed_at else datetime.now().replace(tzinfo=None)
        )
        for idx, (attempt, _) in enumerate(sorted_attempts):
            if attempt.success:
                tries_before_success.append(idx + 1)
                break

    avg_tries = sum(tries_before_success) / len(tries_before_success) if tries_before_success else 0
    min_tries = min(tries_before_success) if tries_before_success else None
    max_tries = max(tries_before_success) if tries_before_success else None

    tff_values = []
    tff_on_page_values = []
    for session_attempts in student_attempts.values():
        sorted_attempts = sorted(
            session_attempts,
            key=lambda pair: pair[0].completed_at.replace(tzinfo=None) if pair[0].completed_at else datetime.now().replace(tzinfo=None)
        )
        for attempt, enrollment in sorted_attempts:
            if not attempt.success and attempt.completed_at:
                if enrollment.started_at:
                    secs_wall = (attempt.completed_at.replace(tzinfo=None) - enrollment.started_at.replace(tzinfo=None)).total_seconds()
                    if secs_wall >= 0:
                        tff_values.append(secs_wall)
                secs_active = active_time_to(enrollment.id, attempt.completed_at)
                if secs_active is not None:
                    tff_on_page_values.append(secs_active)
                break
    tff = compute_box_stats(tff_values)
    tff_on_page = compute_box_stats(tff_on_page_values)

    tfs_values = []
    tfs_on_page_values = []
    for session_attempts in student_attempts.values():
        sorted_attempts = sorted(
            session_attempts,
            key=lambda pair: pair[0].completed_at.replace(tzinfo=None) if pair[0].completed_at else datetime.now().replace(tzinfo=None)
        )
        for attempt, enrollment in sorted_attempts:
            if attempt.success and attempt.completed_at:
                if enrollment.started_at:
                    secs_wall = (attempt.completed_at.replace(tzinfo=None) - enrollment.started_at.replace(tzinfo=None)).total_seconds()
                    if secs_wall >= 0:
                        tfs_values.append(secs_wall)
                secs_active = active_time_to(enrollment.id, attempt.completed_at)
                if secs_active is not None:
                    tfs_on_page_values.append(secs_active)
                break

    tfs = compute_box_stats(tfs_values)
    tfs_on_page = compute_box_stats(tfs_on_page_values)

    # Thinking time: time from enrollment.started_at to first move/edit per student
    enrollment_ids_map = {en.id: en for _, en in attempts_data}
    thinking_values = []
    thinking_on_page_values = []
    for enrollment in enrollment_ids_map.values():
        if not enrollment.started_at:
            continue
        first_move_res = await db.execute(
            select(func.min(MoveEvent.event_time))
            .join(TaskAttempt, TaskAttempt.id == MoveEvent.attempt_id)
            .where(TaskAttempt.student_task_enrollment_id == enrollment.id)
        )
        first_edit_res = await db.execute(
            select(func.min(EditEvent.event_time))
            .join(TaskAttempt, TaskAttempt.id == EditEvent.attempt_id)
            .where(TaskAttempt.student_task_enrollment_id == enrollment.id)
        )
        candidates = [t for t in [first_move_res.scalar(), first_edit_res.scalar()] if t is not None]
        if candidates:
            first_event_time = min(candidates)
            started_at_naive = enrollment.started_at.replace(tzinfo=None)
            first_event_time_naive = first_event_time.replace(tzinfo=None)
            secs = (first_event_time_naive - started_at_naive).total_seconds()
            if 0 <= secs < 3600:  # ignore implausible values
                thinking_values.append(secs)

                # On-page thinking time: sum of active sessions prior to first event
                on_page_secs = 0.0
                slist = sessions_by_enrollment.get(enrollment.id, [])
                for s in slist:
                    s_entered = s.entered_at.replace(tzinfo=None)
                    if s_entered >= first_event_time_naive:
                        break
                    s_exited = s.exited_at.replace(tzinfo=None) if s.exited_at else first_event_time_naive
                    start = max(s_entered, started_at_naive)
                    end = min(s_exited, first_event_time_naive)
                    if end > start:
                        on_page_secs += (end - start).total_seconds()
                thinking_on_page_values.append(on_page_secs)

    thinking_time = compute_box_stats(thinking_values)
    thinking_time_on_page = compute_box_stats(thinking_on_page_values)

    # Number of moves per student: avg/min/max
    move_counts_per_student = []
    for enrollment in enrollment_ids_map.values():
        count_res = await db.execute(
            select(func.count(MoveEvent.id))  # pylint: disable=not-callable
            .join(TaskAttempt, TaskAttempt.id == MoveEvent.attempt_id)
            .where(TaskAttempt.student_task_enrollment_id == enrollment.id)
        )
        cnt = count_res.scalar() or 0
        move_counts_per_student.append(cnt)

    number_of_moves = compute_box_stats(move_counts_per_student)

    # Page exits per student (median/min/max/avg exits)
    page_exits_list = []
    for enrollment_id in enrollment_ids_map.keys():
        slist = sessions_by_enrollment.get(enrollment_id, [])
        exits = max(0, len(slist) - 1)
        page_exits_list.append(exits)

    median_page_exits = 0.0
    min_page_exits = min(page_exits_list) if page_exits_list else None
    max_page_exits = max(page_exits_list) if page_exits_list else None
    avg_page_exits = round(sum(page_exits_list) / len(page_exits_list), 2) if page_exits_list else 0.0

    if page_exits_list:
        sorted_exits = sorted(page_exits_list)
        n_exits = len(sorted_exits)
        if n_exits % 2 == 1:
            median_page_exits = float(sorted_exits[n_exits // 2])
        else:
            median_page_exits = (sorted_exits[n_exits // 2 - 1] + sorted_exits[n_exits // 2]) / 2.0

    # Students enrolled in the task set but never started this task (not started)
    students_not_started = 0
    not_started_student_info: list[dict] = []
    if task_set_code and task_set:
        enrolled_result = await db.execute(
            select(Student.id, Student.username)
            .join(StudentTaskSetEnrollment, StudentTaskSetEnrollment.student_id == Student.id)
            .where(StudentTaskSetEnrollment.task_set_id == task_set.id)
        )
        enrolled_students = {row[0]: row[1] for row in enrolled_result.all()}

        started_result = await db.execute(
            select(StudentTaskEnrollment.student_id)
            .where(
                StudentTaskEnrollment.task_set_id == task_set.id,
                StudentTaskEnrollment.task_id == task.id
            )
        )
        started_student_ids = set(started_result.scalars().all()) | {a.student_id for a, _ in attempts_data}
        not_started_ids = set(enrolled_students.keys()) - started_student_ids
        students_not_started = len(not_started_ids)
        students_attempted = len(started_student_ids)
        not_started_student_info = sorted([{"name": enrolled_students[i], "meta": "", "id": i} for i in not_started_ids], key=lambda x: x["name"])

    # Build per-student try counts for sidebar
    completed_student_info: list[dict] = []
    not_yet_completed_student_info: list[dict] = []
    student_ids_completed = {a.student_id for a, _ in successful_attempts}

    student_usernames_result = await db.execute(
        select(Student.id, Student.username)
        .where(Student.id.in_(set(a.student_id for a, _ in attempts_data)))
    )
    student_id_to_username = {row[0]: row[1] for row in student_usernames_result.all()}

    for student_id, student_attempts_list in student_attempts.items():
        username = student_id_to_username.get(student_id, str(student_id))
        tries = len(student_attempts_list)
        info = {"name": username, "meta": f"{tries} tr{'y' if tries == 1 else 'ies'}", "id": student_id}
        if student_id in student_ids_completed:
            completed_student_info.append(info)
        else:
            not_yet_completed_student_info.append(info)

    completed_student_info.sort(key=lambda x: x["name"])
    not_yet_completed_student_info.sort(key=lambda x: x["name"])

    mistake_counts: dict = {}
    for attempt, _ in failed_attempts:
        if attempt.submitted_inputs and isinstance(attempt.submitted_inputs, dict):
            code = attempt.submitted_inputs.get("code", "")
            if code:
                normalized_code = _clean_mistake_code(code)
                if not normalized_code:
                    continue

                fingerprint = _mistake_code_fingerprint(normalized_code)
                if fingerprint not in mistake_counts:
                    mistake_counts[fingerprint] = {"code": normalized_code, "count": 0}

                mistake_counts[fingerprint]["count"] += 1
                if len(normalized_code) < len(mistake_counts[fingerprint]["code"]):
                    mistake_counts[fingerprint]["code"] = normalized_code

    common_mistakes = [
        {"code": mistake["code"], "count": mistake["count"]}
        for mistake in sorted(mistake_counts.values(), key=lambda item: item["count"], reverse=True)[:5]
    ]

    return {
        "task_name": task.title,
        "is_public": task.is_public,
        "model_answer": await _get_model_answer_for_task(task, db),
        "custom_error_messages": _parse_custom_error_messages(task),
        "total_completions": len(attempts_data),
        "students_attempted": students_attempted,
        "students_completed": students_completed,
        "students_not_started": students_not_started,
        "avg_tries": round(avg_tries, 2),
        "min_tries": min_tries,
        "max_tries": max_tries,
        "time_to_first_fail": tff,
        "time_to_first_fail_on_page": tff_on_page,
        "time_to_first_success": tfs,
        "time_to_first_success_on_page": tfs_on_page,
        "thinking_time": thinking_time,
        "thinking_time_on_page": thinking_time_on_page,
        "median_page_exits": median_page_exits,
        "min_page_exits": min_page_exits,
        "max_page_exits": max_page_exits,
        "avg_page_exits": avg_page_exits,
        "number_of_moves": number_of_moves,
        "common_mistakes": common_mistakes,
        "students": {
            "completed": completed_student_info,
            "not_yet_completed": not_yet_completed_student_info,
            "not_started": not_started_student_info,
        },
    }
