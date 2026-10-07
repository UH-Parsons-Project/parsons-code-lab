from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...database import get_db
from ...models import TaskSet, TaskSetViewer, Teacher
from ...pydantic import TaskSetViewerRequest, TaskSetViewerResponse
from ...teacher_auth import CurrentUser
from ...utils.taskset import require_task_set_view_access
from ..utils.commons import get_task_set_or_404

router = APIRouter()


@router.get("/api/my_sets/{task_set_id}/viewers", response_model=list[TaskSetViewerResponse])
async def list_task_set_viewers(
    task_set_id: int,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    task_set = await get_task_set_or_404(db, TaskSet, task_set_id)
    await require_task_set_view_access(task_set, current_user, db)

    result = await db.execute(
        select(TaskSetViewer, Teacher)
        .join(Teacher, Teacher.id == TaskSetViewer.teacher_id)
        .where(TaskSetViewer.task_set_id == task_set_id)
        .order_by(Teacher.username.asc())
    )
    return [
        TaskSetViewerResponse(
            id=viewer.id,
            task_set_id=viewer.task_set_id,
            teacher_id=teacher.id,
            username=teacher.username,
            email=teacher.email,
            created_at=viewer.created_at.isoformat(),
        )
        for viewer, teacher in result.all()
    ]


@router.post("/api/my_sets/{task_set_id}/viewers", response_model=TaskSetViewerResponse)
async def add_task_set_viewer(
    task_set_id: int,
    request: TaskSetViewerRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    identifier = request.identifier.strip()
    if not identifier:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="username or email is required")

    task_set = await get_task_set_or_404(db, TaskSet, task_set_id)
    if task_set.teacher_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have permission to modify this task set")

    result = await db.execute(
        select(Teacher).where(
            (Teacher.username == identifier) | (Teacher.email == identifier)
        )
    )
    teacher = result.scalar_one_or_none()
    if not teacher or not teacher.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Teacher not found")
    if teacher.id == task_set.teacher_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Task list owner already has access")

    result = await db.execute(
        select(TaskSetViewer).where(
            TaskSetViewer.task_set_id == task_set_id,
            TaskSetViewer.teacher_id == teacher.id,
        )
    )
    viewer = result.scalar_one_or_none()
    if viewer is None:
        viewer = TaskSetViewer(task_set_id=task_set_id, teacher_id=teacher.id)
        db.add(viewer)
        await db.commit()
        await db.refresh(viewer)

    return TaskSetViewerResponse(
        id=viewer.id,
        task_set_id=viewer.task_set_id,
        teacher_id=teacher.id,
        username=teacher.username,
        email=teacher.email,
        created_at=viewer.created_at.isoformat(),
    )


@router.delete("/api/my_sets/{task_set_id}/viewers/{teacher_id}")
async def remove_task_set_viewer(
    task_set_id: int,
    teacher_id: int,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    task_set = await get_task_set_or_404(db, TaskSet, task_set_id)
    if task_set.teacher_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have permission to modify this task set")
    if teacher_id == task_set.teacher_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot remove access from the task set owner")

    result = await db.execute(
        delete(TaskSetViewer).where(
            TaskSetViewer.task_set_id == task_set_id,
            TaskSetViewer.teacher_id == teacher_id,
        )
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Viewer not found")

    await db.commit()
    return {"status": "success"}