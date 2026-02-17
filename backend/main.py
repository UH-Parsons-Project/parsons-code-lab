"""
FastAPI backend for Faded Parsons Problems.
Provides endpoints for each page.
"""

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
from .models import Parsons, Teacher
from .seed import seed_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database and seed data on startup."""
    # Note: Tables are also created by schema.sql in Docker. This provides redundancy
    # and ensures tables exist when running outside Docker or if schema.sql changes.
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


# Mount static directories
app.mount("/js", StaticFiles(directory=BASE_DIR / "js"), name="js")
app.mount(
    "/js-parsons", StaticFiles(directory=BASE_DIR / "js-parsons"), name="js-parsons"
)
app.mount("/dist", StaticFiles(directory=BASE_DIR / "dist"), name="dist")
app.mount("/data", StaticFiles(directory=BASE_DIR / "data"), name="data")


@app.get("/", response_class=HTMLResponse)
async def index():
    """Serve the main index page."""
    index_path = BASE_DIR / "templates" / "index.html"
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


@app.get("/nickname", response_class=HTMLResponse)
async def problem_page():
    """Serve the problem page."""
    problem_path = BASE_DIR / "templates" / "nickname.html"
    return FileResponse(problem_path)


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
