from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse, HTMLResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...teacher_auth import get_current_user
from ...database import get_db
from ...models import Parsons, TaskSet
from ...utils.taskset import can_view_task_in_task_set
from ..utils.commons import require_session_or_redirect, set_no_cache_headers, render_template

router = APIRouter()

# Project root (same as BASE_DIR in main.py)
BASE_DIR = Path(__file__).resolve().parents[3]

def _render_page(template_name: str, request: Request, status_code: int = 200):
    return render_template(template_name, request, status_code=status_code)

def _not_found_page(request: Request):
    return _render_page("common/not-found.html", request, status_code=404)


@router.get("/task-statistics", response_class=HTMLResponse)
async def task_statistics_view(request: Request, db: Annotated[AsyncSession, Depends(get_db)]):
    redirect = await require_session_or_redirect(get_current_user, "/", request, db)
    if redirect:
        return redirect

    task_id_raw = request.query_params.get("id")
    if task_id_raw:
        try:
            task_id = int(task_id_raw)
        except ValueError:
            return _not_found_page(request)

        current_user = await get_current_user(request, db)
        task_result = await db.execute(select(Parsons).where(Parsons.id == task_id))
        task = task_result.scalar_one_or_none()
        if task is None:
            return _not_found_page(request)

        if not task.is_public and task.created_by_teacher_id != current_user.id:
            task_set_code = request.query_params.get("task_set")
            if not task_set_code:
                return _not_found_page(request)

            task_set_result = await db.execute(
                select(TaskSet).where(TaskSet.unique_link_code == task_set_code)
            )
            task_set = task_set_result.scalar_one_or_none()
            if task_set is None or not await can_view_task_in_task_set(task, task_set, current_user, db):
                return _not_found_page(request)

    return _render_page("statistic/task-statistics.html", request)


@router.get("/student-attempts", response_class=HTMLResponse)
async def student_attempts_page(request: Request, db: Annotated[AsyncSession, Depends(get_db)]):
    redirect = await require_session_or_redirect(get_current_user, "/", request, db)
    if redirect:
        return redirect

    return _render_page("student/student-attempts.html", request)


@router.get("/student-task-statistics", response_class=HTMLResponse)
async def student_task_statistics_page(request: Request, db: Annotated[AsyncSession, Depends(get_db)]):
    redirect = await require_session_or_redirect(get_current_user, "/", request, db)
    if redirect:
        return redirect

    return _render_page("statistic/student-task-statistics.html", request)
