from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, status, Request, HTTPException
from fastapi.responses import FileResponse, RedirectResponse, HTMLResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...database import get_db
from ...models import Student, StudentTaskSetEnrollment, TaskSet
from ...student_auth import get_current_student_session_no_update
from ..utils.commons import get_task_set_by_code_or_404, verify_task_in_set_or_404, render_template

BASE_DIR = Path(__file__).resolve().parent.parent.parent.parent

router = APIRouter()


def _closed_response(request: Request):
    return render_template("task/task-set-closed.html", request)


def _render_student_page(template_name: str, request: Request, unique_link_code: str | None = None, task_id: int | None = None):
    headers = {}
    if unique_link_code:
        headers["X-Problemset-Code"] = unique_link_code
    if task_id is not None:
        headers["X-Task-Id"] = str(task_id)
    return render_template(template_name, request, headers=headers)


async def _check_enrollment(db: AsyncSession, student_session: Student | None, task_set: TaskSet) -> bool:
    if not student_session:
        return False
    enrollment = await db.execute(
        select(StudentTaskSetEnrollment).where(
            StudentTaskSetEnrollment.student_id == student_session.id,
            StudentTaskSetEnrollment.task_set_id == task_set.id,
        )
    )
    return enrollment.scalar_one_or_none() is not None


def _is_expired(task_set) -> bool:
    now = datetime.now(timezone.utc)
    if task_set.opens_at:
        opens = task_set.opens_at
        if opens.tzinfo is None:
            opens = opens.replace(tzinfo=timezone.utc)
        if now < opens:
            return True

    if not task_set.expires_at:
        return False
    expires = task_set.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    return now > expires


@router.get("/student-start-task", response_class=HTMLResponse)
async def student_start_view(
    request: Request,
    db: AsyncSession = Depends(get_db),
    student_session: Student | None = Depends(get_current_student_session_no_update),
):
    if not student_session:
        return RedirectResponse(url="/", status_code=status.HTTP_303_SEE_OTHER)

    return render_template("student/student-start-task.html", request)


@router.get("/{username}/set/{unique_link_code}", response_class=HTMLResponse)
async def task_set_page(
    request: Request,
    username: str,
    unique_link_code: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    student_session: Annotated[Student | None, Depends(get_current_student_session_no_update)],
):
    task_set = await get_task_set_by_code_or_404(db, TaskSet, unique_link_code)

    if _is_expired(task_set):
        return _closed_response(request)

    if await _check_enrollment(db, student_session, task_set):
        return RedirectResponse(url=f"/{username}/set/{unique_link_code}/tasks", status_code=status.HTTP_303_SEE_OTHER)

    return _render_student_page("student/student-index.html", request, unique_link_code)


@router.get("/{username}/set/{unique_link_code}/tasks", response_class=HTMLResponse)
async def task_set_tasks_page(
    request: Request,
    username: str,
    unique_link_code: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    student_session: Annotated[Student | None, Depends(get_current_student_session_no_update)],
):
    task_set = await get_task_set_by_code_or_404(db, TaskSet, unique_link_code)

    if _is_expired(task_set):
        return _closed_response(request)

    if not await _check_enrollment(db, student_session, task_set):
        return RedirectResponse(url=f"/{username}/set/{unique_link_code}", status_code=status.HTTP_303_SEE_OTHER)

    return _render_student_page("task/task-set.html", request, unique_link_code)


@router.get("/{username}/set/{unique_link_code}/tasks/{task_id:int}", response_class=HTMLResponse)
async def task_set_task_page(
    request: Request,
    username: str,
    unique_link_code: str,
    task_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    student_session: Annotated[Student | None, Depends(get_current_student_session_no_update)],
):
    task_set = await get_task_set_by_code_or_404(db, TaskSet, unique_link_code)

    if _is_expired(task_set):
        return _closed_response(request)
    try:
        await verify_task_in_set_or_404(db, task_set, task_id, visible_only=True)
    except HTTPException as e:
        return render_template("common/not-found.html", request, status_code=e.status_code)
    if not await _check_enrollment(db, student_session, task_set):
        return RedirectResponse(url=f"/{username}/set/{unique_link_code}", status_code=status.HTTP_303_SEE_OTHER)

    return _render_student_page("student/student-problem.html", request, unique_link_code, task_id)


@router.get("/{username}/set/{unique_link_code}/tasks/{task_id:int}/start", response_class=HTMLResponse)
async def task_set_task_start_page(
    request: Request,
    username: str,
    unique_link_code: str,
    task_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    student_session: Annotated[Student | None, Depends(get_current_student_session_no_update)],
):
    task_set = await get_task_set_by_code_or_404(db, TaskSet, unique_link_code)

    if _is_expired(task_set):
        return _closed_response(request)
    try:
        await verify_task_in_set_or_404(db, task_set, task_id, visible_only=True)
    except HTTPException as e:
        return render_template("common/not-found.html", request, status_code=e.status_code)
    if not await _check_enrollment(db, student_session, task_set):
        return RedirectResponse(url=f"/{username}/set/{unique_link_code}", status_code=status.HTTP_303_SEE_OTHER)

    return _render_student_page("student/student-start-task.html", request, unique_link_code, task_id)


@router.get("/demo", response_class=HTMLResponse)
@router.get("/{username}/set/{unique_link_code}/tasks/demo", response_class=HTMLResponse)
@router.get("/{username}/set/{unique_link_code}/tasks/demo/start", response_class=HTMLResponse)
async def demo_task_page(request: Request):
    return render_template("student/demo.html", request)


@router.get("/student-register", response_class=HTMLResponse)
async def student_register_page(request: Request):
    return render_template("student/student-register.html", request)


@router.get("/student/profile", response_class=HTMLResponse)
async def student_profile_page(
    request: Request,
    db: AsyncSession = Depends(get_db),
    student_session: Student | None = Depends(get_current_student_session_no_update),
):
    if not student_session:
        return RedirectResponse(url="/", status_code=status.HTTP_303_SEE_OTHER)

    return render_template("student/student-profile.html", request)
