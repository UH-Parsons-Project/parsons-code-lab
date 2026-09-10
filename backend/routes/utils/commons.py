from pathlib import Path
from typing import Iterable, Callable, Any

from fastapi import HTTPException, status, Request
from fastapi.responses import RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...models import TaskSetItem
from ... import config

BASE_DIR = Path(__file__).resolve().parents[3]
templates = Jinja2Templates(directory=BASE_DIR / "templates")


async def get_task_set_or_404(db: AsyncSession, task_set_model, task_set_id: int):
    stmt = select(task_set_model).where(task_set_model.id == task_set_id)
    result = await db.execute(stmt)
    task_set = result.scalar_one_or_none()
    if not task_set:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task list with id {task_set_id} not found",
        )
    return task_set


async def get_task_set_by_code_or_404(db: AsyncSession, task_set_model, unique_link_code: str):
    """Fetch a TaskSet by its unique link code or raise 404."""
    stmt = select(task_set_model).where(task_set_model.unique_link_code == unique_link_code)
    result = await db.execute(stmt)
    task_set = result.scalar_one_or_none()
    if not task_set:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Problem set with code {unique_link_code} not found",
        )
    return task_set



async def verify_task_in_set_or_404(db: AsyncSession, task_set, task_id: int, visible_only: bool = False) -> None:
    """Verify that a real task_id belongs to the given task set.

    Raises 404 if the task is not in the set, 410 if it exists but is hidden and visible_only=True.
    """
    stmt = select(TaskSetItem).where(
        TaskSetItem.task_set_id == task_set.id,
        TaskSetItem.task_id == task_id,
    )
    result = await db.execute(stmt)
    item = result.scalar_one_or_none()

    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found in this set",
        )

    if visible_only and item.is_hidden:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="This task is no longer available",
        )


def build_taskset_response_list(rows: Iterable):
    """Build a list of TaskSetResponse-like dicts from query rows.

    The function returns plain dicts matching the Pydantic model fields so it
    can be returned directly from FastAPI endpoints regardless of response
    model usage.
    """
    result = []
    for row in rows:
        ps, owner_username, *rest = row
        student_count = rest[0] if len(rest) > 0 else 0
        task_count = rest[1] if len(rest) > 1 else 0
        result.append({
            "id": ps.id,
            "title": ps.title,
            "unique_link_code": ps.unique_link_code,
            "teacher_id": ps.teacher_id,
            "owner_username": owner_username,
            "student_description": ps.student_description,
            "teacher_description": ps.teacher_description,
            "created_at": ps.created_at.isoformat(),
            "opens_at": ps.opens_at.isoformat() if getattr(ps, "opens_at", None) else None,
            "expires_at": ps.expires_at.isoformat() if ps.expires_at else None,
            "student_count": student_count,
            "task_count": task_count,
        })
    return result


def set_no_cache_headers(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    return response


def render_template(template_name: str, request: Request, status_code: int = 200, headers: dict | None = None):
    response = templates.TemplateResponse(
        request=request,
        name=template_name,
        status_code=status_code,
        context={"saml_enabled": config.SAML_ENABLED},
    )
    set_no_cache_headers(response)
    if headers:
        for k, v in headers.items():
            response.headers[k] = v
    return response


async def require_session_or_redirect(check_func: Callable[..., Any], redirect_url: str, *args, **kwargs):
    """Run `check_func(*args, **kwargs)` and return a RedirectResponse if it raises HTTPException.

    Returns None when the check passes; otherwise returns a RedirectResponse instance that
    the caller should return to the client.
    """
    try:
        await check_func(*args, **kwargs)
    except HTTPException:
        return RedirectResponse(url=redirect_url, status_code=status.HTTP_303_SEE_OTHER)
    return None


def validate_registration_basic(username: str, password: str, password_confirm: str, email: str,
                                username_max: int = 50, email_max: int = 100,
                                min_username: int = 5, min_password: int = 8):
    if not username or not password or not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="username, password and email are required",
        )

    if password != password_confirm:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Passwords do not match",
        )

    if len(username) > username_max or len(email) > email_max:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="username or email too long",
        )

    if len(username) < min_username:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"username must have a minimum length of {min_username} characters",
        )

    if len(password) < min_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"password must have a minimum length of {min_password} characters",
        )


async def ensure_unique_user(db: AsyncSession, model, username: str, email: str, check_username: bool = True):
    if check_username:
        stmt = select(model).where((model.username == username) | (model.email == email))
    else:
        stmt = select(model).where(model.email == email)

    result = await db.execute(stmt)
    existing = result.scalar_one_or_none()
    if existing:
        detail = "Username or email already exists" if check_username else "Email already exists"
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=detail,
        )


async def get_ids_from_stmt(db: AsyncSession, stmt):
    """Execute a select that returns single-column rows and return list of values."""
    result = await db.execute(stmt)
    rows = result.all()
    ids = [row[0] for row in rows]
    return ids


async def run_with_task_ids_or_empty(db: AsyncSession, task_ids_stmt, handler):
    """Fetch task ids, return [] if none, otherwise call `await handler(task_ids)`.

    `handler` must be an async callable accepting a single argument `task_ids`.
    """
    task_ids = await get_ids_from_stmt(db, task_ids_stmt)
    if not task_ids:
        return []
    return await handler(task_ids)
