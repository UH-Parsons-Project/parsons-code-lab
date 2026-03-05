"""
FastAPI backend for Faded Parsons Problems.
Provides endpoints for each page.
"""

import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from .auth import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    CurrentUser,
    authenticate_user,
    create_access_token,
    get_current_user,
)
from .database import get_db, init_db
from .models import Parsons, TaskList, TaskListItem, TaskAttempt, StudentSession
from .reset_db import reset_db
from .seed import seed_db
from .student_auth import (
    create_student_session,
    set_session_cookie,
    get_current_student_session,
    get_current_student_session_no_update,
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Initialize database and seed data on startup."""
    await init_db()
    await seed_db()
    yield


app = FastAPI(title="Faded Parsons Problems", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Change to specific origins in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parent.parent


# Pydantic models for request/response
class Token(BaseModel):
    access_token: str
    token_type: str


class UserInfo(BaseModel):
    username: str
    email: str


class TaskResponse(BaseModel):
    id: int
    title: str
    description: str
    task_type: str
    code_blocks: dict
    correct_solution: dict
    is_public: bool
    created_at: str


class ProblemSetResponse(BaseModel):
    id: int
    title: str
    unique_link_code: str
    teacher_id: int
    created_at: str
    expires_at: str | None


class ProblemSetTaskResponse(BaseModel):
    id: int
    title: str
    task_type: str
    created_at: str


class NicknameRequest(BaseModel):
    nickname: str
    unique_link_code: str


class SubmitTestResultRequest(BaseModel):
    task_id: int
    success: bool
    submitted_code: str
    test_output: str
    repr_code: str
    start_time: str | None = None  # ISO format timestamp from localStorage


# Mount static directories (only if they exist)
js_dir = BASE_DIR / "js"
if js_dir.exists():
    app.mount("/js", StaticFiles(directory=js_dir), name="js")

js_parsons_dir = BASE_DIR / "js-parsons"
if js_parsons_dir.exists():
    app.mount(
        "/js-parsons", StaticFiles(directory=js_parsons_dir), name="js-parsons"
    )

dist_dir = BASE_DIR / "dist"
if dist_dir.exists():
    app.mount("/dist", StaticFiles(directory=dist_dir), name="dist")

data_dir = BASE_DIR / "data"
if data_dir.exists():
    app.mount("/data", StaticFiles(directory=data_dir), name="data")


TEST_MODE = os.getenv("TEST_MODE", "false").lower() == "true"

@app.post("/test/reset-db")
async def reset_test_db():
    """Reset the database (requires TEST_MODE env variable)."""
    if not TEST_MODE:
        raise HTTPException(
            status_code=403,
            detail="Test endpoints are only available in test mode"
        )
    try:
        await reset_db()
        await seed_db()
        return {"status": "success", "message": "Database reset complete"}
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to reset database: {str(e)}"
        ) from e


@app.get("/", response_class=HTMLResponse)
async def index():
    """Serve the main index page."""
    index_path = BASE_DIR / "templates" / "index.html"
    return FileResponse(index_path)

@app.get("/student_start_page", response_class=HTMLResponse)
async def student_start_view():
    index_path = BASE_DIR / "templates" / "student_start_page.html"
    return FileResponse(index_path)

@app.get("/index.html", response_class=HTMLResponse)
async def index_html():
    index_path = BASE_DIR / "templates" / "index.html"
    return FileResponse(index_path)


@app.get("/problem.html", response_class=HTMLResponse)
async def problem_page():
    problem_path = BASE_DIR / "templates" / "problem.html"
    return FileResponse(problem_path)


@app.get("/set/{unique_link_code}", response_class=HTMLResponse)
async def problemset_page(
    unique_link_code: str,
    db: AsyncSession = Depends(get_db),
    student_session = Depends(get_current_student_session_no_update)
):
    stmt = select(TaskList).where(TaskList.unique_link_code == unique_link_code)
    result = await db.execute(stmt)
    problemset = result.scalar_one_or_none()

    if not problemset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Problem set with code {unique_link_code} not found",
        )

    if student_session:
        return RedirectResponse(url=f"/set/{unique_link_code}/tasks", status_code=status.HTTP_303_SEE_OTHER)

    problemset_path = BASE_DIR / "templates" / "nickname.html"
    response = FileResponse(problemset_path)
    response.headers["X-Problemset-Code"] = unique_link_code
    return response


@app.get("/set/{unique_link_code}/tasks", response_class=HTMLResponse)
async def problemset_tasks_page(unique_link_code: str, db: AsyncSession = Depends(get_db)):
    stmt = select(TaskList).where(TaskList.unique_link_code == unique_link_code)
    result = await db.execute(stmt)
    problemset = result.scalar_one_or_none()

    if not problemset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Problem set with code {unique_link_code} not found",
        )

    tasks_path = BASE_DIR / "templates" / "problemset.html"
    response = FileResponse(tasks_path)
    response.headers["X-Problemset-Code"] = unique_link_code
    return response


@app.get("/set/{unique_link_code}/tasks/{task_id:int}", response_class=HTMLResponse)
async def problemset_task_page(unique_link_code: str, task_id: int, db: AsyncSession = Depends(get_db)):
    stmt = select(TaskList).where(TaskList.unique_link_code == unique_link_code)
    result = await db.execute(stmt)
    problemset = result.scalar_one_or_none()

    if not problemset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Problem set with code {unique_link_code} not found",
        )

    task_path = BASE_DIR / "templates" / "student_problem.html"
    response = FileResponse(task_path)
    response.headers["X-Problemset-Code"] = unique_link_code
    response.headers["X-Task-Id"] = str(task_id)
    return response


@app.get("/set/{unique_link_code}/tasks/{task_id:int}/description", response_class=HTMLResponse)
async def problemset_task_description_page(unique_link_code: str, task_id: int, db: AsyncSession = Depends(get_db)):
    stmt = select(TaskList).where(TaskList.unique_link_code == unique_link_code)
    result = await db.execute(stmt)
    problemset = result.scalar_one_or_none()

    if not problemset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Problem set with code {unique_link_code} not found",
        )

    description_path = BASE_DIR / "templates" / "problem.html"
    response = FileResponse(description_path)
    response.headers["X-Problemset-Code"] = unique_link_code
    response.headers["X-Task-Id"] = str(task_id)
    return response


@app.get("/set/{unique_link_code}/tasks/{task_id:int}/start", response_class=HTMLResponse)
async def problemset_task_start_page(unique_link_code: str, task_id: int, db: AsyncSession = Depends(get_db)):
    stmt = select(TaskList).where(TaskList.unique_link_code == unique_link_code)
    result = await db.execute(stmt)
    problemset = result.scalar_one_or_none()

    if not problemset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Problem set with code {unique_link_code} not found",
        )

    start_path = BASE_DIR / "templates" / "student_start_page.html"
    response = FileResponse(start_path)
    response.headers["X-Problemset-Code"] = unique_link_code
    response.headers["X-Task-Id"] = str(task_id)
    return response


@app.get("/exerciselist")
async def exercise_list(request: Request, db: AsyncSession = Depends(get_db)):
    try:
        await get_current_user(request, db)
    except HTTPException:
        return RedirectResponse(
            url="/index.html", status_code=status.HTTP_303_SEE_OTHER
        )

    exerciselist_path = BASE_DIR / "templates" / "exerciselist.html"
    response = FileResponse(exerciselist_path)
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    return response


@app.get("/statics_view", response_class=HTMLResponse)
async def statics_view(request: Request, db: AsyncSession = Depends(get_db)):
    try:
        await get_current_user(request, db)
    except HTTPException:
        return RedirectResponse(
            url="/index.html", status_code=status.HTTP_303_SEE_OTHER
        )

    statics_path = BASE_DIR / "templates" / "statics_view.html"
    response = FileResponse(statics_path)
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    return response


# Authentication endpoints
@app.post("/api/login/access-token", response_model=Token)
async def login_access_token(
    response: Response,
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: AsyncSession = Depends(get_db),
):
    user = await authenticate_user(form_data.username, form_data.password, db)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect username or password",
        )
    elif not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Inactive user"
        )

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires
    )

    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        path="/",
        samesite="lax",
        secure=False,  # Set to True in production with HTTPS
    )

    return Token(access_token=access_token, token_type="bearer")


@app.get("/api/me", response_model=UserInfo)
async def get_current_user_info(current_user: CurrentUser):
    return UserInfo(username=current_user.username, email=current_user.email)


@app.post("/api/logout")
async def logout(response: Response):
    response.delete_cookie(key="access_token", path="/")
    return {"message": "Successfully logged out"}


@app.post("/api/validate-nickname")
async def validate_nickname(
    request: NicknameRequest,
    response: Response,
    db: AsyncSession = Depends(get_db)
):
    """Validate nickname and create student session. Must be less than 21 characters (max 20)."""
    nickname = request.nickname.strip()
    unique_link_code = request.unique_link_code.strip()

    if not nickname:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nickname cannot be empty",
        )

    if len(nickname) > 20:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nickname must be less than 21 characters",
        )

    stmt = select(TaskList).where(TaskList.unique_link_code == unique_link_code)
    result = await db.execute(stmt)
    task_list = result.scalar_one_or_none()

    if not task_list:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task list with code {unique_link_code} not found",
        )

    student_session = await create_student_session(
        task_list_id=task_list.id,
        nickname=nickname,
        db=db
    )

    set_session_cookie(response, student_session.session_id)

    return {
        "status": "valid",
        "nickname": nickname,
        "session_id": str(student_session.session_id)
    }


@app.get("/api/tasks/{task_id}", response_model=TaskResponse)
async def get_task(task_id: int, db: AsyncSession = Depends(get_db)):
    stmt = select(Parsons).where(Parsons.id == task_id)
    result = await db.execute(stmt)
    task = result.scalar_one_or_none()

    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task with id {task_id} not found",
        )

    return TaskResponse(
        id=task.id,
        title=task.title,
        description=task.description,
        task_type=task.task_type,
        code_blocks=task.code_blocks,
        correct_solution=task.correct_solution,
        is_public=task.is_public,
        created_at=task.created_at.isoformat(),
    )


@app.get("/api/tasks")
async def list_tasks(db: AsyncSession = Depends(get_db)):
    import json

    result = await db.execute(select(Parsons).where(Parsons.is_public))
    tasks = result.scalars().all()

    task_list = []
    for task in tasks:
        try:
            description_data = json.loads(task.description)
            description_text = description_data.get("description", "")
        except (json.JSONDecodeError, AttributeError):
            description_text = ""

        task_list.append(
            {
                "id": task.id,
                "title": task.title,
                "description": description_text,
                "task_type": task.task_type,
                "created_at": task.created_at.isoformat(),
            }
        )

    return task_list


@app.get("/api/problemsets/{problemset_id}", response_model=ProblemSetResponse)
async def get_problemset(problemset_id: int, db: AsyncSession = Depends(get_db)):
    stmt = select(TaskList).where(TaskList.id == problemset_id)
    result = await db.execute(stmt)
    problemset = result.scalar_one_or_none()

    if not problemset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Problemset with id {problemset_id} not found",
        )

    return ProblemSetResponse(
        id=problemset.id,
        title=problemset.title,
        unique_link_code=problemset.unique_link_code,
        teacher_id=problemset.teacher_id,
        created_at=problemset.created_at.isoformat(),
        expires_at=problemset.expires_at.isoformat() if problemset.expires_at else None,
    )


@app.get("/api/problemsets/{code}/tasks", response_model=list[ProblemSetTaskResponse])
async def get_problemset_tasks(code: str, db: AsyncSession = Depends(get_db)):
    """Get all tasks belonging to a problemset. Accepts either a unique link code or an integer ID."""
    # Determine whether the caller passed an integer ID or a string code
    code_str = str(code)
    if code_str.isdigit():
        problemset_stmt = select(TaskList).where(TaskList.id == int(code))
    else:
        problemset_stmt = select(TaskList).where(TaskList.unique_link_code == code)

    problemset_result = await db.execute(problemset_stmt)
    problemset = problemset_result.scalar_one_or_none()

    if not problemset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Problem set '{code}' not found",
        )

    stmt = (
        select(Parsons)
        .join(TaskListItem, TaskListItem.task_id == Parsons.id)
        .where(TaskListItem.task_list_id == problemset.id)
        .order_by(TaskListItem.id.asc())
    )
    result = await db.execute(stmt)
    tasks = result.scalars().all()

    return [
        ProblemSetTaskResponse(
            id=task.id,
            title=task.title,
            task_type=task.task_type,
            created_at=task.created_at.isoformat(),
        )
        for task in tasks
    ]


@app.post("/api/tasks/{task_id}/submit-result")
async def submit_test_result(
    task_id: int,
    result: SubmitTestResultRequest,
    db: AsyncSession = Depends(get_db),
    student_session: StudentSession | None = Depends(get_current_student_session)
):
    if not student_session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Student session required to save results"
        )

    if result.start_time:
        try:
            task_started_at = datetime.fromisoformat(result.start_time.replace('Z', '+00:00'))
        except (ValueError, AttributeError):
            task_started_at = datetime.now(timezone.utc)
    else:
        task_started_at = datetime.now(timezone.utc)

    new_attempt = TaskAttempt(
        student_session_id=student_session.id,
        task_id=task_id,
        task_started_at=task_started_at,
        completed_at=datetime.now(timezone.utc),
        success=result.success,
        submitted_inputs={"code": result.submitted_code}
    )
    db.add(new_attempt)
    await db.commit()

    return {"status": "success", "message": "Test result saved"}


@app.get("/api/tasks/{task_id}/statistics")
async def get_task_statistics(
    task_id: int,
    current_user: CurrentUser,
    problemset_code: str | None = None,
    db: AsyncSession = Depends(get_db)
):
    # Verify task exists
    task_result = await db.execute(select(Parsons).where(Parsons.id == task_id))
    task = task_result.scalar_one_or_none()

    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task with id {task_id} not found"
        )

    # Build attempts query, optionally filtered by problemset
    attempts_query = select(TaskAttempt).where(TaskAttempt.task_id == task_id)

    if problemset_code:
        problemset_result = await db.execute(
            select(TaskList).where(TaskList.unique_link_code == problemset_code)
        )
        problemset = problemset_result.scalar_one_or_none()

        if problemset:
            attempts_query = (
                select(TaskAttempt)
                .join(StudentSession, TaskAttempt.student_session_id == StudentSession.id)
                .where(
                    TaskAttempt.task_id == task_id,
                    StudentSession.task_list_id == problemset.id
                )
            )

    attempts_result = await db.execute(attempts_query)
    attempts = attempts_result.scalars().all()

    if not attempts:
        return {
            "task_name": task.title,
            "total_completions": 0,
            "students_attempted": 0,
            "students_completed": 0,
            "avg_tries": 0,
            "time_to_first_fail": {"avg": 0, "min": 0, "max": 0},
            "time_to_first_success": {"avg": 0, "min": 0, "max": 0},
            "thinking_time": None,
            "number_of_moves": None,
            "common_mistakes": []
        }

    successful_attempts = [a for a in attempts if a.success]
    failed_attempts = [a for a in attempts if not a.success]

    students_attempted = len(set(a.student_session_id for a in attempts))
    students_completed = len(set(a.student_session_id for a in successful_attempts))

    # Average tries before first success (per student)
    student_attempts: dict = {}
    for attempt in attempts:
        student_attempts.setdefault(attempt.student_session_id, []).append(attempt)

    tries_before_success = []
    for session_attempts in student_attempts.values():
        sorted_attempts = sorted(session_attempts, key=lambda a: a.completed_at or datetime.now(timezone.utc))
        for idx, attempt in enumerate(sorted_attempts):
            if attempt.success:
                tries_before_success.append(idx + 1)
                break

    avg_tries = sum(tries_before_success) / len(tries_before_success) if tries_before_success else 0

    # Time to first fail
    tff_values = [
        (a.completed_at - a.task_started_at).total_seconds()
        for a in failed_attempts
        if a.completed_at and a.task_started_at
    ]
    tff = {
        "avg": round(sum(tff_values) / len(tff_values), 2) if tff_values else 0,
        "min": round(min(tff_values), 2) if tff_values else 0,
        "max": round(max(tff_values), 2) if tff_values else 0,
    }

    # Time to first success
    tfs_values = []
    for session_attempts in student_attempts.values():
        sorted_attempts = sorted(session_attempts, key=lambda a: a.completed_at or datetime.now(timezone.utc))
        for attempt in sorted_attempts:
            if attempt.success and attempt.completed_at and attempt.task_started_at:
                tfs_values.append((attempt.completed_at - attempt.task_started_at).total_seconds())
                break

    tfs = {
        "avg": round(sum(tfs_values) / len(tfs_values), 2) if tfs_values else 0,
        "min": round(min(tfs_values), 2) if tfs_values else 0,
        "max": round(max(tfs_values), 2) if tfs_values else 0,
    }

    # Common mistakes (top 5 most frequent failed submissions)
    mistake_counts: dict = {}
    for attempt in failed_attempts:
        if attempt.submitted_inputs and isinstance(attempt.submitted_inputs, dict):
            code = attempt.submitted_inputs.get("code", "")
            if code:
                mistake_counts[code] = mistake_counts.get(code, 0) + 1

    common_mistakes = [
        {"code": code, "count": count}
        for code, count in sorted(mistake_counts.items(), key=lambda x: x[1], reverse=True)[:5]
    ]

    return {
        "task_name": task.title,
        "total_completions": len(attempts),
        "students_attempted": students_attempted,
        "students_completed": students_completed,
        "avg_tries": round(avg_tries, 2),
        "time_to_first_fail": tff,
        "time_to_first_success": tfs,
        "thinking_time": None,   # Not yet tracked — requires first-action event
        "number_of_moves": None, # Not yet tracked — requires move_events table
        "common_mistakes": common_mistakes,
    }
