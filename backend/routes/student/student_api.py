import re
import secrets
from collections import defaultdict
from datetime import datetime, timezone
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from ...teacher_auth import CurrentUser
from ...pydantic import SubmitTestResultRequest, RecordExitRequest, EnterTaskResponse, StartTaskResponse, TaskResponse, StudentTaskResponse
from ...database import get_db
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
from ...pydantic import (
    EnterTaskResponse,
    RecordExitRequest,
    StartTaskResponse,
    SubmitTestResultRequest,
    TaskResponse,
)
from ...rate_limit import check_brute_force, clear_failed_attempts, limiter, record_failed_attempt
from ...student_auth import (
    authenticate_student,
    get_current_student_session,
    get_current_student_session_no_update,
    set_session_cookie,
)
from ...utils.taskset import require_task_set_view_access
from ..utils.commons import (
    ensure_unique_user,
    get_task_set_by_code_or_404,
    validate_registration_basic,
    verify_task_in_set_or_404,
)

router = APIRouter()


def _parse_iso_datetime(value: str):
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    return datetime.fromisoformat(value)


async def _resolve_task_context(db: AsyncSession, unique_link_code: str, task_id: int) -> tuple[TaskSet, int]:
    task_set = await get_task_set_by_code_or_404(db, TaskSet, unique_link_code)
    await verify_task_in_set_or_404(db, task_set, task_id, visible_only=True)
    return task_set, task_id


@router.get("/api/student/me")
async def get_student_me(
    student_session: Annotated[Student | None, Depends(get_current_student_session_no_update)],
):
    if not student_session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not logged in")
    return {"username": student_session.username}

EMAIL_REGEX = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


@router.get("/api/student/profile")
async def get_student_profile(
    db: Annotated[AsyncSession, Depends(get_db)],
    student_session: Annotated[Student | None, Depends(get_current_student_session_no_update)],
):
    if not student_session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not logged in")

    joined_sets_stmt = (
        select(
            TaskSet.id,
            TaskSet.title,
            TaskSet.unique_link_code,
            Teacher.username.label("teacher_username"),
            StudentTaskSetEnrollment.enrolled_at,
        )
        .join(TaskSet, TaskSet.id == StudentTaskSetEnrollment.task_set_id)
        .join(Teacher, Teacher.id == TaskSet.teacher_id)
        .where(StudentTaskSetEnrollment.student_id == student_session.id)
        .order_by(StudentTaskSetEnrollment.enrolled_at.desc(), TaskSet.title.asc())
    )
    joined_sets_result = await db.execute(joined_sets_stmt)
    joined_sets = joined_sets_result.all()

    joined_task_sets = []
    joined_set_ids = [row.id for row in joined_sets]

    task_counts: dict[int, int] = {}
    completed_counts: dict[int, int] = {}

    if joined_set_ids:
        task_counts_result = await db.execute(
            select(
                TaskSetItem.task_set_id,
                func.count(TaskSetItem.id).label("task_count"),
            )
            .where(TaskSetItem.task_set_id.in_(joined_set_ids))
            .group_by(TaskSetItem.task_set_id)
        )
        task_counts = {
            row.task_set_id: int(row.task_count or 0)
            for row in task_counts_result.all()
        }

        completed_counts_result = await db.execute(
            select(
                StudentTaskEnrollment.task_set_id,
                func.count(func.distinct(StudentTaskEnrollment.task_id)).label("completed_tasks"),
            )
            .join(TaskAttempt, TaskAttempt.student_task_enrollment_id == StudentTaskEnrollment.id)
            .where(
                StudentTaskEnrollment.student_id == student_session.id,
                StudentTaskEnrollment.task_set_id.in_(joined_set_ids),
                TaskAttempt.success.is_(True),
            )
            .group_by(StudentTaskEnrollment.task_set_id)
        )
        completed_counts = {
            row.task_set_id: int(row.completed_tasks or 0)
            for row in completed_counts_result.all()
        }

    for row in joined_sets:
        task_count = task_counts.get(row.id, 0)
        completed_tasks = completed_counts.get(row.id, 0)
        joined_task_sets.append(
            {
                "id": row.id,
                "title": row.title,
                "unique_link_code": row.unique_link_code,
                "teacher_username": row.teacher_username,
                "enrolled_at": row.enrolled_at.isoformat() if row.enrolled_at else "",
                "task_count": task_count,
                "completed_tasks": completed_tasks,
                "is_completed": completed_tasks >= task_count > 0,
            }
        )

    joined_task_sets.sort(
        key=lambda item: (
            item["is_completed"],
            -_parse_iso_datetime(item["enrolled_at"]).timestamp() if item["enrolled_at"] else 0,
        )
    )

    return {
        "username": student_session.username,
        "email": student_session.email,
        "student_created_at": student_session.student_created_at.isoformat() if student_session.student_created_at else "",
        "joined_task_sets": joined_task_sets,
    }


@router.post("/api/student/profile/email")
async def update_student_email(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    student_session: Annotated[Student | None, Depends(get_current_student_session)],
):
    if not student_session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not logged in")

    body = await request.json()
    new_email = body.get("email", "").strip()
    password = body.get("password", "")

    if not new_email or not password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email and password are required")

    if not student_session.verify_password(password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Incorrect password")

    if len(new_email) > 100:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email too long")

    if not re.match(EMAIL_REGEX, new_email):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid email format")

    # Check email uniqueness against other students
    email_stmt = select(Student).where(Student.email == new_email, Student.id != student_session.id)
    email_result = await db.execute(email_stmt)
    if email_result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email is already in use")

    student_session.email = new_email
    await db.commit()
    return {"status": "success", "message": "Email updated successfully"}


@router.post("/api/student/profile/password")
async def update_student_password(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    student_session: Annotated[Student | None, Depends(get_current_student_session)],
):
    if not student_session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not logged in")

    body = await request.json()
    current_password = body.get("current_password", "")
    new_password = body.get("new_password", "")
    new_password_confirm = body.get("new_password_confirm", "")

    if not current_password or not new_password or not new_password_confirm:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="All password fields are required")

    if not student_session.verify_password(current_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Incorrect current password")

    if new_password != new_password_confirm:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="New passwords do not match")

    if current_password == new_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="New password cannot be the same as the current password")

    if len(new_password) < 8:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password must have a minimum length of 8 characters")

    student_session.set_password(new_password)
    await db.commit()
    return {"status": "success", "message": "Password updated successfully"}

@router.get("/api/sets/{unique_link_code}/info")
async def get_task_set_info(
    unique_link_code: str,
    db: Annotated[AsyncSession, Depends(get_db)]
):
    stmt = select(TaskSet, Teacher).join(Teacher).where(TaskSet.unique_link_code == unique_link_code)
    result = await db.execute(stmt)
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Task set not found")

    task_set, teacher = row
    return {
        "title": task_set.title,
        "teacher": teacher.username
    }


@router.post("/api/sets/{unique_link_code}/join")
async def join_task_set(
    unique_link_code: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    student_session: Annotated[Student | None, Depends(get_current_student_session)],
):
    if not student_session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Student session required")

    task_set_stmt = select(TaskSet).where(TaskSet.unique_link_code == unique_link_code)
    task_set_result = await db.execute(task_set_stmt)
    task_set = task_set_result.scalar_one_or_none()
    if not task_set:
        raise HTTPException(status_code=404, detail="Task set not found")

    existing_stmt = select(StudentTaskSetEnrollment).where(
        StudentTaskSetEnrollment.student_id == student_session.id,
        StudentTaskSetEnrollment.task_set_id == task_set.id,
    )
    existing_result = await db.execute(existing_stmt)
    if not existing_result.scalar_one_or_none():
        db.add(StudentTaskSetEnrollment(
            student_id=student_session.id,
            task_set_id=task_set.id,
        ))
        await db.commit()

    return {"status": "enrolled"}


@router.get("/api/sets/{unique_link_code}/is-enrolled")
async def check_enrollment(
    unique_link_code: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    student_session: Annotated[Student | None, Depends(get_current_student_session_no_update)],
):
    if not student_session:
        return {"enrolled": False}

    task_set_stmt = select(TaskSet).where(TaskSet.unique_link_code == unique_link_code)
    task_set_result = await db.execute(task_set_stmt)
    task_set = task_set_result.scalar_one_or_none()
    if not task_set:
        return {"enrolled": False}

    stmt = select(StudentTaskSetEnrollment).where(
        StudentTaskSetEnrollment.student_id == student_session.id,
        StudentTaskSetEnrollment.task_set_id == task_set.id,
    )
    result = await db.execute(stmt)
    return {"enrolled": result.scalar_one_or_none() is not None}


@router.post("/api/student_login")
@limiter.limit("20/minute")
async def student_login(
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    body = await request.json()
    email = body.get("email") if isinstance(body, dict) else None
    password = body.get("password") if isinstance(body, dict) else None
    unique_link_code = body.get("unique_link_code") if isinstance(body, dict) else None

    if email is None or password is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="email and password are required")

    identifier = email.strip().lower()

    remaining = check_brute_force(identifier)
    if remaining is not None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Account temporarily locked. Try again in {int(remaining // 60) + 1} minute(s).",
        )

    student = await authenticate_student(email, password, db)
    if not student:
        record_failed_attempt(identifier)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect email or password",
        )

    clear_failed_attempts(identifier)

    now = datetime.now(timezone.utc)
    student.last_activity_at = now
    if not student.started_at:
        student.started_at = now

    if unique_link_code:
        stmt = select(TaskSet).where(TaskSet.unique_link_code == unique_link_code)
        result = await db.execute(stmt)
        task_set = result.scalar_one_or_none()
        if task_set:
            enroll_result = await db.execute(
                select(StudentTaskSetEnrollment).where(
                    StudentTaskSetEnrollment.student_id == student.id,
                    StudentTaskSetEnrollment.task_set_id == task_set.id,
                )
            )
            if not enroll_result.scalar_one_or_none():
                db.add(StudentTaskSetEnrollment(
                    student_id=student.id,
                    task_set_id=task_set.id,
                ))

    student.session_token = secrets.token_urlsafe(32)
    await db.commit()

    set_session_cookie(response, student.session_token)
    return {"status": "success", "student_id": student.id, "username": student.username}


@router.post("/api/student_logout")
async def student_logout(
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[Student | None, Depends(get_current_student_session)],
):
    if student:
        student.session_token = None
        await db.commit()
    response.delete_cookie(key="student_session", path="/")
    return {"message": "Successfully logged out"}


@router.post("/api/student_register")
@limiter.limit("10/minute")
async def api_student_register(
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    reg_identifier = f"student_reg:{request.client.host}"

    remaining = check_brute_force(reg_identifier)
    if remaining is not None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many failed attempts. Try again in {int(remaining // 60) + 1} minute(s).",
        )
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid JSON payload")

    username = str(payload.get("username", "")).strip()
    password = payload.get("password", "")
    password_confirm = payload.get("password_confirm", "")
    email = str(payload.get("email", "")).strip()
    unique_link_code = payload.get("unique_link_code")

    # Basic validation (lengths, presence, password match)
    validate_registration_basic(username, password, password_confirm, email,
                                username_max=20, email_max=100)

    # Ensure uniqueness in DB
    await ensure_unique_user(db, Student, username, email, check_username=False)

    student = Student(username=username, email=email)
    student.set_password(password)
    student.started_at = datetime.now(timezone.utc)
    student.last_activity_at = datetime.now(timezone.utc)
    student.session_token = secrets.token_urlsafe(32)

    db.add(student)
    await db.commit()
    await db.refresh(student)

    if unique_link_code:
        stmt = select(TaskSet).where(TaskSet.unique_link_code == unique_link_code)
        result = await db.execute(stmt)
        task_set = result.scalar_one_or_none()
        if task_set:
            enroll_result = await db.execute(
                select(StudentTaskSetEnrollment).where(
                    StudentTaskSetEnrollment.student_id == student.id,
                    StudentTaskSetEnrollment.task_set_id == task_set.id,
                )
            )
            if not enroll_result.scalar_one_or_none():
                db.add(StudentTaskSetEnrollment(
                    student_id=student.id,
                    task_set_id=task_set.id,
                ))
                await db.commit()

    set_session_cookie(response, student.session_token)

    clear_failed_attempts(reg_identifier)
    return {"status": "success", "id": student.id}


@router.get("/api/sets/{unique_link_code}/tasks/{task_id}", response_model=StudentTaskResponse)
async def get_task_for_student_set(
    task_id: int,
    unique_link_code: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    student_session: Annotated[Student | None, Depends(get_current_student_session_no_update)],
):
    if not student_session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Student session required")

    _, resolved_task_id = await _resolve_task_context(db, unique_link_code, task_id)

    stmt = select(Parsons).where(Parsons.id == resolved_task_id)
    result = await db.execute(stmt)
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task with id {resolved_task_id} not found",
        )


    submitted_order = None
    if student_session:
        attempt_stmt = (
            select(TaskAttempt)
            .where(
                (TaskAttempt.student_id == student_session.id) &
                (TaskAttempt.task_id == resolved_task_id) &
                (TaskAttempt.success.is_(True))
            )
            .order_by(TaskAttempt.completed_at.desc())
            .limit(1)
        )
        attempt_result = await db.execute(attempt_stmt)
        attempt = attempt_result.scalar_one_or_none()
        if attempt and getattr(attempt, 'submitted_order', None):
            submitted_order = attempt.submitted_order

    student_correct_solution = {}
    if isinstance(task.correct_solution, dict):
        if "teacher_tests" in task.correct_solution:
            student_correct_solution["teacher_tests"] = task.correct_solution["teacher_tests"]
        if "custom_error_messages" in task.correct_solution:
            student_correct_solution["custom_error_messages"] = task.correct_solution["custom_error_messages"]

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
        eval_type=task.correct_solution.get("eval_type", "unit_test"),
        expected_output=task.correct_solution.get("expected_output", ""),
        correct_order=task.correct_solution.get("correct_order", []),
        require_indentation=task.correct_solution.get("require_indentation", True),
    )


@router.get("/api/sets/{unique_link_code}/tasks-status")
async def get_all_tasks_status(
    unique_link_code: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    student_session: Annotated[Student | None, Depends(get_current_student_session_no_update)],
):
    task_set = await get_task_set_by_code_or_404(db, TaskSet, unique_link_code)

    stmt_tasks = select(TaskSetItem.task_id).where(
        (TaskSetItem.task_set_id == task_set.id) &
        (TaskSetItem.is_hidden == False)
    ).order_by(TaskSetItem.id.asc())
    result_tasks = await db.execute(stmt_tasks)
    visible_task_ids = result_tasks.scalars().all()

    statuses = []

    if not student_session:
        for t_id in visible_task_ids:
            statuses.append({"has_started": False, "student_attempts": 0, "student_completed": 0})
        return statuses

    if not visible_task_ids:
        return []

    stmt_enrollments = select(StudentTaskEnrollment.task_id).where(
        (StudentTaskEnrollment.student_id == student_session.id) &
        (StudentTaskEnrollment.task_set_id == task_set.id) &
        (StudentTaskEnrollment.task_id.in_(visible_task_ids))
    )
    result_enrollments = await db.execute(stmt_enrollments)
    started_task_ids = set(result_enrollments.scalars().all())

    stmt_attempts = (
        select(TaskAttempt.task_id, TaskAttempt.success)
        .join(StudentTaskEnrollment, StudentTaskEnrollment.id == TaskAttempt.student_task_enrollment_id)
        .where(
            (TaskAttempt.student_id == student_session.id) &
            (StudentTaskEnrollment.task_set_id == task_set.id) &
            (TaskAttempt.task_id.in_(visible_task_ids))
        )
    )
    result_attempts = await db.execute(stmt_attempts)
    attempts = result_attempts.all()

    from collections import defaultdict
    task_attempts_map = defaultdict(lambda: {"attempts": 0, "completed": 0})
    for attempt in attempts:
        task_attempts_map[attempt.task_id]["attempts"] += 1
        if attempt.success:
            task_attempts_map[attempt.task_id]["completed"] += 1

    for t_id in visible_task_ids:
        statuses.append({
            "has_started": t_id in started_task_ids,
            "student_attempts": task_attempts_map[t_id]["attempts"],
            "student_completed": task_attempts_map[t_id]["completed"],
        })

    return statuses


@router.get("/api/sets/{unique_link_code}/tasks/{task_id}/has-started")
async def check_task_has_started(
    task_id: int,
    unique_link_code: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    student_session: Annotated[Student | None, Depends(get_current_student_session)],
):
    if not student_session:
        return {"has_started": False}

    task_set, resolved_task_id = await _resolve_task_context(db, unique_link_code, task_id)

    stmt = select(StudentTaskEnrollment).where(
        (StudentTaskEnrollment.student_id == student_session.id) &
        (StudentTaskEnrollment.task_id == resolved_task_id) &
        (StudentTaskEnrollment.task_set_id == task_set.id)
    )
    result = await db.execute(stmt)
    existing_enrollment = result.scalar_one_or_none()

    return {"has_started": existing_enrollment is not None}


@router.get("/api/sets/{unique_link_code}/tasks/{task_id}/my-completion-status")
async def get_my_completion_status(
    task_id: int,
    unique_link_code: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    student_session: Annotated[Student | None, Depends(get_current_student_session_no_update)],
):
    if not student_session:
        return {"student_attempts": 0, "student_completed": 0}

    task_set, resolved_task_id = await _resolve_task_context(db, unique_link_code, task_id)

    stmt = (
        select(TaskAttempt)
        .join(StudentTaskEnrollment, StudentTaskEnrollment.id == TaskAttempt.student_task_enrollment_id)
        .where(
            (TaskAttempt.student_id == student_session.id) &
            (TaskAttempt.task_id == resolved_task_id) &
            (StudentTaskEnrollment.task_set_id == task_set.id)
        )
    )
    result = await db.execute(stmt)
    attempts = result.scalars().all()

    student_attempts = len(attempts)
    student_completed = sum(1 for a in attempts if a.success)

    return {"student_attempts": student_attempts, "student_completed": student_completed}


async def _get_or_create_enrollment(
    db: AsyncSession, student_id: int, task_id: int, task_set_id: int
) -> StudentTaskEnrollment:
    stmt = select(StudentTaskEnrollment).where(
        (StudentTaskEnrollment.student_id == student_id) &
        (StudentTaskEnrollment.task_id == task_id) &
        (StudentTaskEnrollment.task_set_id == task_set_id)
    )
    result = await db.execute(stmt)
    enrollment = result.scalar_one_or_none()

    if not enrollment:
        enrollment = StudentTaskEnrollment(
            student_id=student_id,
            task_id=task_id,
            task_set_id=task_set_id
        )
        db.add(enrollment)
        await db.flush()
    return enrollment


async def _create_task_session(db: AsyncSession, enrollment: StudentTaskEnrollment) -> TaskSession:
    session = TaskSession(student_task_enrollment_id=enrollment.id)
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


@router.post("/api/sets/{unique_link_code}/tasks/{task_id}/start", response_model=StartTaskResponse)
async def start_task(
    task_id: int,
    unique_link_code: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    student_session: Annotated[Student | None, Depends(get_current_student_session)],
):
    if not student_session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Student session required to start a task"
        )

    task_set, resolved_task_id = await _resolve_task_context(db, unique_link_code, task_id)
    enrollment = await _get_or_create_enrollment(db, student_session.id, resolved_task_id, task_set.id)
    session = await _create_task_session(db, enrollment)

    return StartTaskResponse(
        started_at=enrollment.started_at.isoformat(),
        session_id=session.id,
        entered_at=session.entered_at.isoformat(),
    )


@router.post("/api/sets/{unique_link_code}/tasks/{task_id}/submit-result")
async def submit_test_result(
    task_id: int,
    unique_link_code: str,
    result: SubmitTestResultRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    student_session: Annotated[Student | None, Depends(get_current_student_session)],
):
    if not student_session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Student session required to save results"
        )

    task_set, resolved_task_id = await _resolve_task_context(db, unique_link_code, task_id)
    enrollment = await _get_or_create_enrollment(db, student_session.id, resolved_task_id, task_set.id)

    open_session_stmt = (
        select(TaskSession)
        .where(TaskSession.student_task_enrollment_id == enrollment.id)
        .where(TaskSession.exited_at.is_(None))
        .order_by(TaskSession.entered_at.desc())
        .limit(1)
    )
    open_session_result = await db.execute(open_session_stmt)
    open_session = open_session_result.scalar_one_or_none()

    new_attempt = TaskAttempt(
        student_id=student_session.id,
        task_id=resolved_task_id,
        student_task_enrollment_id=enrollment.id,
        task_session_id=open_session.id if open_session else None,
        completed_at=datetime.now(timezone.utc),
        success=result.success,
        submitted_inputs={"code": result.submitted_code}
    )
    db.add(new_attempt)
    await db.flush()
    await db.refresh(new_attempt)


    if result.success and result.arrangement:
        try:
            new_attempt.submitted_order = result.arrangement
            await db.flush()
        except Exception:
            pass

    if result.moves:
        for move_data in result.moves:
            move_kwargs = {
                "attempt_id": new_attempt.id,
                "block_id": move_data.block_id,
                "from_container": move_data.from_container,
                "to_container": move_data.to_container,
                "from_index": move_data.from_index,
                "to_index": move_data.to_index,
                "from_indent": move_data.from_indent,
                "to_indent": move_data.to_indent,
            }
            if move_data.event_time:
                move_kwargs["event_time"] = _parse_iso_datetime(move_data.event_time)
            db.add(MoveEvent(**move_kwargs))

    if result.edits:
        for edit_data in result.edits:
            edit = EditEvent(
                attempt_id=new_attempt.id,
                block_id=edit_data.block_id,
                blank_index=edit_data.blank_index,
                value=edit_data.value,
                event_time=_parse_iso_datetime(edit_data.event_time),
            )
            db.add(edit)

    await db.commit()

    return {
        "status": "success",
        "message": "Test result saved",
        "attempt_id": new_attempt.id
    }


@router.post("/api/sets/{unique_link_code}/tasks/{task_id}/enter", response_model=EnterTaskResponse)
async def enter_task(
    task_id: int,
    unique_link_code: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    student_session: Annotated[Student | None, Depends(get_current_student_session)],
):
    if not student_session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Student session required"
        )

    task_set, resolved_task_id = await _resolve_task_context(db, unique_link_code, task_id)
    enrollment = await _get_or_create_enrollment(db, student_session.id, resolved_task_id, task_set.id)
    session = await _create_task_session(db, enrollment)

    return EnterTaskResponse(
        session_id=session.id,
        entered_at=session.entered_at.isoformat(),
    )


@router.post("/api/sets/{unique_link_code}/tasks/{task_id}/record-exit")
async def record_task_exit(
    task_id: int,
    unique_link_code: str,
    body: RecordExitRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    student_session: Annotated[Student | None, Depends(get_current_student_session_no_update)],
):
    if not student_session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Student session required"
        )

    task_set, resolved_task_id = await _resolve_task_context(db, unique_link_code, task_id)

    stmt = (
        select(TaskSession)
        .join(StudentTaskEnrollment, StudentTaskEnrollment.id == TaskSession.student_task_enrollment_id)
        .where(TaskSession.id == body.session_id)
        .where(StudentTaskEnrollment.student_id == student_session.id)
        .where(StudentTaskEnrollment.task_id == resolved_task_id)
        .where(StudentTaskEnrollment.task_set_id == task_set.id)
    )
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session.exited_at = datetime.fromisoformat(body.exited_at)
    session.exit_reason = body.exit_reason
    await db.commit()
    return {"status": "success"}


@router.get("/api/students/{student_id}/tasks/{task_id}/moves")
async def get_task_moves(
    student_id: int,
    task_id: int,
    set_id: int,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    task_set = await db.get(TaskSet, set_id)
    if not task_set:
        raise HTTPException(status_code=404, detail="Task set not found")
    await require_task_set_view_access(task_set, current_user, db)

    student = await db.get(Student, student_id)

    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    stmt = (
        select(TaskAttempt)
        .join(StudentTaskEnrollment, TaskAttempt.student_task_enrollment_id == StudentTaskEnrollment.id)
        .where(
            (TaskAttempt.student_id == student.id) &
            (TaskAttempt.task_id == task_id) &
            (StudentTaskEnrollment.task_set_id == set_id)
        )
    )
    result = await db.execute(stmt)
    attempts = result.scalars().all()

    attempt_ids = [a.id for a in attempts]

    if not attempt_ids:
        return []

    stmt = select(MoveEvent).where(MoveEvent.attempt_id.in_(attempt_ids))
    result = await db.execute(stmt)
    moves = result.scalars().all()

    stmt = select(EditEvent).where(EditEvent.attempt_id.in_(attempt_ids))
    result = await db.execute(stmt)
    edits = result.scalars().all()

    task_result = await db.execute(select(Parsons).where(Parsons.id == task_id))
    task = task_result.scalar_one_or_none()

    eval_type = getattr(task, "eval_type", None)
    if not eval_type and task and hasattr(task, "correct_solution") and task.correct_solution:
        if isinstance(task.correct_solution, dict):
            eval_type = task.correct_solution.get("eval_type")
        else:
            eval_type = getattr(task.correct_solution, "eval_type", None)
    eval_type = eval_type or "unit_test"

    # main.js appends these 4 extra lines to codeLines before passing to the widget
    # for non-order_only tasks, so they get sortable-codelineN IDs.
    DEBUG_LINES = [
        {"code": "print('DEBUG:', !BLANK)", "given": False, "indent": 0},
        {"code": "print('DEBUG:', !BLANK)", "given": False, "indent": 0},
        {"code": "# !BLANK", "given": False, "indent": 0},
        {"code": "# !BLANK", "given": False, "indent": 0},
    ] if eval_type != "order_only" else []

    initial_blocks = []
    block_code_map = {}
    if task and task.code_blocks and "blocks" in task.code_blocks:
        draggable_index = 0
        for block in task.code_blocks["blocks"]:
            # Sanitize stored block code: avoid leaking raw <input> HTML into replay.
            raw_code = block.get("code", "") or ""
            # Replace any <input ...>...</input> or self-closing <input .../> with the !BLANK token
            sanitized_code = re.sub(r"<input[^>]*>(?:</input>)?", "!BLANK", raw_code, flags=re.IGNORECASE)
            sanitized_code = re.sub(r"<input[^>]*/>", "!BLANK", sanitized_code, flags=re.IGNORECASE)
            # Remove any other HTML tags that might remain
            sanitized_code = re.sub(r"<[^>]+>", "", sanitized_code)

            if not block.get("given", False):
                block_id = f"sortable-codeline{draggable_index}"
                block_code_map[block_id] = sanitized_code
                initial_blocks.append({
                    "block_id": block_id,
                    "code": sanitized_code,
                    "given": False,
                    "indent": block.get("indent", 0),
                })
                draggable_index += 1

        for debug in DEBUG_LINES:
            block_id = f"sortable-codeline{draggable_index}"
            block_code_map[block_id] = debug["code"]
            initial_blocks.append({
                "block_id": block_id,
                "code": debug["code"],
                "given": False,
                "indent": 0,
                "debug": True,
            })
            draggable_index += 1
        # Given blocks come last in the widget's modified_lines
        for block in task.code_blocks["blocks"]:
            if block.get("given", False):
                raw_code = block.get("code", "") or ""
                sanitized_code = re.sub(r"<input[^>]*>(?:</input>)?", "!BLANK", raw_code, flags=re.IGNORECASE)
                sanitized_code = re.sub(r"<input[^>]*/>", "!BLANK", sanitized_code, flags=re.IGNORECASE)
                sanitized_code = re.sub(r"<[^>]+>", "", sanitized_code)

                block_id = f"sortable-codeline{draggable_index}"
                block_code_map[block_id] = sanitized_code
                initial_blocks.append({
                    "block_id": block_id,
                    "code": sanitized_code,
                    "given": True,
                    "indent": block.get("indent", 0),
                })
                draggable_index += 1

    move_events = [
        {
            "type": "move",
            "block_id": move.block_id,
            "block_code": block_code_map.get(move.block_id, ""),
            "from_container": move.from_container,
            "to_container": move.to_container,
            "from_index": move.from_index,
            "to_index": move.to_index,
            "from_indent": move.from_indent,
            "to_indent": move.to_indent,
            "event_time": move.event_time.isoformat(),
        }
        for move in moves
    ]

    edit_events = [
        {
            "type": "edit",
            "block_id": edit.block_id,
            "block_code": block_code_map.get(edit.block_id, ""),
            "blank_index": edit.blank_index,
            "value": edit.value,
            "event_time": edit.event_time.isoformat(),
        }
        for edit in edits
    ]

    run_events = [
        {
            "type": "run",
            "success": attempt.success,
            "event_time": attempt.completed_at.isoformat(),
        }
        for attempt in attempts
        if attempt.completed_at is not None and attempt.success is not None
    ]

    all_events = sorted(move_events + edit_events + run_events, key=lambda e: e["event_time"])

    stmt_session = (
        select(TaskSession)
        .join(StudentTaskEnrollment, TaskSession.student_task_enrollment_id == StudentTaskEnrollment.id)
        .where(
            (StudentTaskEnrollment.student_id == student.id) &
            (StudentTaskEnrollment.task_id == task_id) &
            (StudentTaskEnrollment.task_set_id == set_id)
        )
        .order_by(TaskSession.entered_at.asc())
    )
    res_session = await db.execute(stmt_session)
    first_session = res_session.scalars().first()
    start_time = first_session.entered_at.isoformat() if (first_session and first_session.entered_at) else (all_events[0]["event_time"] if all_events else None)

    return {
        "events": all_events,
        "initial_blocks": initial_blocks,
        "start_time": start_time,
    }
