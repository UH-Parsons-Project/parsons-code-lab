"""
FastAPI backend for Faded Parsons Problems.
Provides endpoints for each page.
"""

import os
from contextlib import asynccontextmanager
from datetime import timedelta
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
from .models import Parsons, TaskList, TaskListItem
from .reset_db import reset_db
from .seed import seed_db


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Initialize database and seed data on startup."""
    # Create tables from SQLAlchemy models and seed initial data
    await init_db()
    await seed_db()
    yield


app = FastAPI(title="Faded Parsons Problems", lifespan=lifespan)

# CORS middleware for development (restrict in production)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Change to specific origins in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Get the base directory (parent of backend folder)
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


# Test-only endpoint
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
    """Serve the main index page."""
    index_path = BASE_DIR / "templates" / "student_start_page.html"
    return FileResponse(index_path)

@app.get("/index.html", response_class=HTMLResponse)
async def index_html():
    """Serve the main index page (explicit path)."""
    index_path = BASE_DIR / "templates" / "index.html"
    return FileResponse(index_path)


@app.get("/problem.html", response_class=HTMLResponse)
async def problem_page():
    """Serve the problem page."""
    problem_path = BASE_DIR / "templates" / "problem.html"
    return FileResponse(problem_path)


@app.get("/set/{unique_link_code}", response_class=HTMLResponse)
async def problemset_page(unique_link_code: str, db: AsyncSession = Depends(get_db)):
    """Serve problemset page by unique link code."""
    stmt = select(TaskList).where(TaskList.unique_link_code == unique_link_code)
    result = await db.execute(stmt)
    problemset = result.scalar_one_or_none()

    if not problemset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Problem set with code {unique_link_code} not found",
        )

    problemset_path = BASE_DIR / "templates" / "nickname.html"
    response = FileResponse(problemset_path)
    response.headers["X-Problemset-Code"] = unique_link_code
    return response


@app.get("/set/{unique_link_code}/tasks", response_class=HTMLResponse)
async def problemset_tasks_page(unique_link_code: str, db: AsyncSession = Depends(get_db)):
    """Serve task list page by unique link code."""
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
    """Serve task page by unique link code and task id."""
    stmt = select(TaskList).where(TaskList.unique_link_code == unique_link_code)
    result = await db.execute(stmt)
    problemset = result.scalar_one_or_none()

    if not problemset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Problem set with code {unique_link_code} not found",
        )

    task_path = BASE_DIR / "templates" / "problem.html"
    response = FileResponse(task_path)
    response.headers["X-Problemset-Code"] = unique_link_code
    response.headers["X-Task-Id"] = str(task_id)
    return response


@app.get("/set/{unique_link_code}/tasks/{task_id:int}/description", response_class=HTMLResponse)
async def problemset_task_description_page(unique_link_code: str, task_id: int, db: AsyncSession = Depends(get_db)):
    """Serve task description page by unique link code and task id."""
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
    """Serve the start page for a task by unique link code and task id."""
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
    """Serve the exercise list page (protected endpoint)."""
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
    """
    Serve the statics view page (protected endpoint).
    """
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
    """
    OAuth2 compatible token login, get an access token for future requests.
    Also sets an HTTP-only cookie for browser-based page navigation.
    """
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

    # Set HTTP-only cookie for browser page navigation
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,  # Convert to seconds
        path="/",
        samesite="lax",
        secure=False,  # Set to True in production with HTTPS
    )

    return Token(access_token=access_token, token_type="bearer")


@app.get("/api/me", response_model=UserInfo)
async def get_current_user_info(current_user: CurrentUser):
    """
    Get current authenticated user information.
    """
    return UserInfo(username=current_user.username, email=current_user.email)


@app.post("/api/logout")
async def logout(response: Response):
    """
    Logout user by clearing the authentication cookie.
    """
    response.delete_cookie(key="access_token", path="/")
    return {"message": "Successfully logged out"}


@app.post("/api/validate-nickname")
async def validate_nickname(request: NicknameRequest):
    """Validate nickname length. Must be less than 21 characters (max 20)."""
    nickname = request.nickname.strip()
    
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
    
    return {"status": "valid", "nickname": nickname}


@app.get("/api/tasks/{task_id}", response_model=TaskResponse)
async def get_task(task_id: int, db: AsyncSession = Depends(get_db)):
    """
    Get a single task by ID.
    Returns the complete task data including code blocks and solution.
    """
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
    """
    List all public tasks.
    Returns: array of tasks with basic info (no code blocks).
    """
    import json

    query = select(Parsons).where(Parsons.is_public)

    result = await db.execute(query)
    tasks = result.scalars().all()

    task_list = []
    for task in tasks:
        # Parse the description JSON to get the actual description text
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
    """Get a single problemset (task list) by id."""
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
async def get_problemset_tasks_by_code(code: str, db: AsyncSession = Depends(get_db)):
    """Get all tasks belonging to a problemset by unique link code."""

    problemset_stmt = select(TaskList).where(TaskList.unique_link_code == code)
    problemset_result = await db.execute(problemset_stmt)
    problemset = problemset_result.scalar_one_or_none()

    if not problemset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Problem set with code {code} not found",
        )

    stmt = (
        select(Parsons)
        .join(TaskListItem, TaskListItem.task_id == Parsons.id)
        .where(TaskListItem.task_list_id == problemset.id)
        .order_by(TaskListItem.id.asc())
    )
    result = await db.execute(stmt)
    tasks = result.scalars().all()

    problemset_tasks: list[ProblemSetTaskResponse] = []
    for task in tasks:
        problemset_tasks.append(
            ProblemSetTaskResponse(
                id=task.id,
                title=task.title,
                task_type=task.task_type,
                created_at=task.created_at.isoformat(),
            )
        )

    return problemset_tasks


@app.get("/api/problemsets/{problemset_id:int}/tasks", response_model=list[ProblemSetTaskResponse])
async def get_problemset_tasks(problemset_id: int, db: AsyncSession = Depends(get_db)):
    """Get all tasks belonging to a problemset (task list) by id."""

    problemset_stmt = select(TaskList.id).where(TaskList.id == problemset_id)
    problemset_result = await db.execute(problemset_stmt)
    problemset_exists = problemset_result.scalar_one_or_none()

    if not problemset_exists:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Problemset with id {problemset_id} not found",
        )

    stmt = (
        select(Parsons)
        .join(TaskListItem, TaskListItem.task_id == Parsons.id)
        .where(TaskListItem.task_list_id == problemset_id)
        .order_by(TaskListItem.id.asc())
    )
    result = await db.execute(stmt)
    tasks = result.scalars().all()

    problemset_tasks: list[ProblemSetTaskResponse] = []
    for task in tasks:
        problemset_tasks.append(
            ProblemSetTaskResponse(
                id=task.id,
                title=task.title,
                task_type=task.task_type,
                created_at=task.created_at.isoformat(),
            )
        )

    return problemset_tasks
