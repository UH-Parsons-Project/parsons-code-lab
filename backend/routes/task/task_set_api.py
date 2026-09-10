import io
import json
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status, Response
from sqlalchemy import and_, case, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...teacher_auth import CurrentUser, OptionalCurrentUser
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
    TaskSetViewer,
    Teacher,
    TeacherFavoriteTask,
)
from ...pydantic import (
    CreateProblemRequest,
    CreateTaskSetRequest,
    InitialEventsExportRequest,
    StudentInTaskSetResponse,
    TaskResponse,
    TaskSetResponse,
    TaskSetTaskResponse,
    TaskSetViewerRequest,
    TaskSetViewerResponse,
    TeacherLookupResponse,
    UpdateExpiresAtRequest,
    UpdateOpensAtRequest,
    UpdateTaskSetTasksRequest,
)
from ...utils.task import is_task_editable
from ...utils.taskset import has_task_set_view_access, require_task_set_view_access
from backend.utils import generate_slug
from ..utils.commons import (
    build_taskset_response_list,
    get_task_set_or_404,
    run_with_task_ids_or_empty,
)

router = APIRouter()

INITIAL_EVENTS_HEADERS = [
    "userID", "starting time", "first attempt time", "event_type", "event_time",
    "block-id", "from_container", "to_container", "from_index", "to_index",
    "from_indent", "to_indent", "blank_index", "value",
]


def _csv_datetime(value: datetime | None) -> str:
    return value.isoformat(timespec="microseconds") if value else ""


def _initial_events_csv(rows: list[list[str]]) -> str:
    all_rows = [INITIAL_EVENTS_HEADERS, *rows]
    widths = [
        max(len(str(row[column_index] or "")) for row in all_rows)
        for column_index in range(len(INITIAL_EVENTS_HEADERS))
    ]

    return "\n".join(
        " ; ".join(
            str(cell or "").ljust(widths[column_index])
            for column_index, cell in enumerate(row)
        )
        for row in all_rows
    )


def _safe_filename_part(value: str, fallback: str) -> str:
    safe = "".join(char if char.isalnum() or char in "-_" else "_" for char in (value or ""))
    return safe.strip("_") or fallback
ALLOWED_TASK_TYPES = {
    "algorithms",
    "arithmetic",
    "booleans",
    "classes",
    "comprehensions",
    "conditionals",
    "debugging",
    "dictionaries",
    "exceptions",
    "files",
    "functions",
    "imports",
    "input",
    "lists",
    "loops",
    "other",
    "printing",
    "recursion",
    "searching",
    "sets",
    "sorting",
    "strings",
    "testing",
    "tuples",
    "typecasting",
    "variables",
}


def _normalize_task_type(task_type: str | None) -> str:
    return (task_type or "").strip().lower()


def _resolve_task_type(task_type: str | None, has_faded: bool) -> str:
    normalized = _normalize_task_type(task_type)
    if not normalized:
        return "Faded" if has_faded else "normal"

    if normalized in ALLOWED_TASK_TYPES:
        return normalized

    if normalized == "normal":
        return "normal"

    if normalized == "faded":
        return "Faded"

    if normalized not in ALLOWED_TASK_TYPES:
        allowed = ", ".join(sorted(ALLOWED_TASK_TYPES))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"task_type is required and must be one of: {allowed}",
        )
    return normalized


def _validate_task_set_dates(opens_at: datetime | None, expires_at: datetime | None) -> None:
    if not opens_at or not expires_at:
        return

    normalized_opens_at = (
        opens_at.replace(tzinfo=timezone.utc)
        if opens_at.tzinfo is None
        else opens_at.astimezone(timezone.utc)
    )
    normalized_expires_at = (
        expires_at.replace(tzinfo=timezone.utc)
        if expires_at.tzinfo is None
        else expires_at.astimezone(timezone.utc)
    )
    if normalized_opens_at > normalized_expires_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Opening date must be before or equal to expiration date",
        )


@router.get("/api/my_sets", response_model=list[TaskSetResponse])
async def list_my_sets(current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    """List all task sets for the current teacher."""
    stmt = (
        select(
            TaskSet,
            Teacher.username,
            func.count(func.distinct(StudentTaskSetEnrollment.student_id)).label("student_count"),
            func.count(func.distinct(TaskSetItem.id)).label("task_count"),
        )
        .join(Teacher, Teacher.id == TaskSet.teacher_id)
        .outerjoin(TaskSetViewer, TaskSetViewer.task_set_id == TaskSet.id)
        .outerjoin(StudentTaskSetEnrollment, StudentTaskSetEnrollment.task_set_id == TaskSet.id)
        .outerjoin(TaskSetItem, TaskSetItem.task_set_id == TaskSet.id)
        .where(
            (TaskSet.teacher_id == current_user.id) | (TaskSetViewer.teacher_id == current_user.id)
        )
        .group_by(TaskSet.id, Teacher.username)
        .order_by(TaskSet.created_at.desc())
    )
    result = await db.execute(stmt)
    my_sets = result.all()

    return build_taskset_response_list(my_sets)


@router.get("/api/my_sets/{task_set_id}", response_model=TaskSetResponse)
async def get_task_set(
    task_set_id: int,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)]
):
    stmt = (
        select(TaskSet, Teacher.username)
        .join(Teacher, Teacher.id == TaskSet.teacher_id)
        .where(TaskSet.id == task_set_id)
    )
    result = await db.execute(stmt)
    row = result.first()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Problemset with id {task_set_id} not found",
        )

    task_set, owner_username = row

    await require_task_set_view_access(task_set, current_user, db)

    enrolled_count = (await db.execute(
        select(func.count(StudentTaskSetEnrollment.id))
        .where(StudentTaskSetEnrollment.task_set_id == task_set.id)
    )).scalar() or 0

    return TaskSetResponse(
        id=task_set.id,
        title=task_set.title,
        unique_link_code=task_set.unique_link_code,
        teacher_id=task_set.teacher_id,
        owner_username=owner_username,
        student_description=task_set.student_description,
        teacher_description=task_set.teacher_description,
        created_at=task_set.created_at.isoformat(),
        opens_at=task_set.opens_at.isoformat() if task_set.opens_at else None,
        expires_at=task_set.expires_at.isoformat() if task_set.expires_at else None,
        deletable=task_set.teacher_id == current_user.id and enrolled_count == 0,
    )


@router.get("/api/my_sets/{code}/tasks", response_model=list[TaskSetTaskResponse])
async def get_task_set_tasks(code: str, response: Response, db: Annotated[AsyncSession, Depends(get_db)]):
    """Get all tasks belonging to a task_set by unique link code."""
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    task_set_result = await db.execute(
        select(TaskSet).where(TaskSet.unique_link_code == code)
    )
    task_set = task_set_result.scalar_one_or_none()

    if not task_set:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Problem set '{code}' not found",
        )

    stmt = (
        select(Parsons, TaskSetItem.is_hidden)
        .join(TaskSetItem, TaskSetItem.task_id == Parsons.id)
        .where(TaskSetItem.task_set_id == task_set.id)
        .order_by(TaskSetItem.id.asc())
    )
    result = await db.execute(stmt)
    rows = result.all()

    tasks_payload = []
    for task, is_hidden in rows:
        solution = task.correct_solution if isinstance(task.correct_solution, dict) else {}

        tasks_payload.append(
            TaskSetTaskResponse(
                id=task.id,
                title=task.title,
                task_type=task.task_type,
                created_at=task.created_at.isoformat(),
                is_hidden=is_hidden,
                is_public=task.is_public,
                is_faded=bool(solution.get("require_indentation", True)),
                require_indentation=bool(solution.get("require_indentation", True)),
            )
        )

    return tasks_payload


@router.patch("/api/my_sets/{task_set_id}/tasks/{task_id}/hidden")
async def toggle_task_hidden(
    task_set_id: int,
    task_id: int,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Toggle the hidden status of a task within a task set."""
    task_set = await get_task_set_or_404(db, TaskSet, task_set_id)
    if task_set.teacher_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No permission to modify this task set")

    item_result = await db.execute(
        select(TaskSetItem).where(
            TaskSetItem.task_set_id == task_set_id,
            TaskSetItem.task_id == task_id,
        )
    )
    item = item_result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found in this task set")

    item.is_hidden = not item.is_hidden
    await db.commit()
    return {"task_id": task_id, "is_hidden": item.is_hidden}


@router.put("/api/my_sets/{task_set_id}/tasks")
async def update_task_set_tasks(
    task_set_id: int,
    request: UpdateTaskSetTasksRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Replace and reorder all tasks in a task set, preserving existing is_hidden flags."""
    task_set = await get_task_set_or_404(db, TaskSet, task_set_id)
    if task_set.teacher_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No permission to modify this task set")

    if request.task_ids:
        # Verify tasks exist
        stmt = select(Parsons.id).where(Parsons.id.in_(request.task_ids))
        result = await db.execute(stmt)
        existing_parsons_ids = set(result.scalars().all())
        if len(existing_parsons_ids) != len(set(request.task_ids)):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="One or more tasks not found")

    # Get existing task items to preserve is_hidden status
    existing_items_stmt = select(TaskSetItem).where(TaskSetItem.task_set_id == task_set_id)
    existing_items_result = await db.execute(existing_items_stmt)
    existing_items = existing_items_result.scalars().all()
    hidden_map = {item.task_id: item.is_hidden for item in existing_items}

    # Delete existing items for this task set
    await db.execute(delete(TaskSetItem).where(TaskSetItem.task_set_id == task_set_id))

    # Re-insert items in exact order specified by request.task_ids
    for task_id in request.task_ids:
        is_hidden = hidden_map.get(task_id, False)
        db.add(TaskSetItem(task_set_id=task_set_id, task_id=task_id, is_hidden=is_hidden))

    await db.commit()
    return {"status": "success", "task_count": len(request.task_ids)}


@router.post("/api/my_sets/{task_set_id}/tasks", status_code=status.HTTP_201_CREATED)
async def add_tasks_to_task_set(
    task_set_id: int,
    request: UpdateTaskSetTasksRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Add tasks to an existing task set without removing existing ones."""
    task_set = await get_task_set_or_404(db, TaskSet, task_set_id)
    if task_set.teacher_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No permission to modify this task set")

    if not request.task_ids:
        return {"status": "success", "added_count": 0}

    # Verify tasks exist
    stmt = select(Parsons.id).where(Parsons.id.in_(request.task_ids))
    result = await db.execute(stmt)
    existing_parsons_ids = set(result.scalars().all())
    if len(existing_parsons_ids) != len(set(request.task_ids)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="One or more tasks not found")

    # Check existing items to prevent duplicates
    existing_stmt = select(TaskSetItem.task_id).where(
        TaskSetItem.task_set_id == task_set_id,
        TaskSetItem.task_id.in_(request.task_ids)
    )
    existing_result = await db.execute(existing_stmt)
    existing_task_ids = set(existing_result.scalars().all())

    tasks_to_add = [tid for tid in request.task_ids if tid not in existing_task_ids]
    for task_id in tasks_to_add:
        db.add(TaskSetItem(task_set_id=task_set_id, task_id=task_id))

    await db.commit()
    return {"status": "success", "added_count": len(tasks_to_add)}


@router.get("/api/my_sets/{code}/info", response_model=TaskSetResponse)
async def get_task_set_info(code: str, db: Annotated[AsyncSession, Depends(get_db)]):
    """Get info for a task set by unique link code."""
    stmt = (
        select(TaskSet, Teacher.username)
        .join(Teacher, Teacher.id == TaskSet.teacher_id)
        .where(TaskSet.unique_link_code == code)
    )
    result = await db.execute(stmt)
    row = result.first()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Problem set '{code}' not found",
        )

    task_set, owner_username = row

    return TaskSetResponse(
        id=task_set.id,
        title=task_set.title,
        unique_link_code=task_set.unique_link_code,
        teacher_id=task_set.teacher_id,
        owner_username=owner_username,
        student_description=task_set.student_description,
        teacher_description=task_set.teacher_description,
        created_at=task_set.created_at.isoformat(),
        opens_at=task_set.opens_at.isoformat() if task_set.opens_at else None,
        expires_at=task_set.expires_at.isoformat() if task_set.expires_at else None,
    )



@router.post("/api/create_task_set", response_model=TaskSetResponse)
async def create_task_set(
    request: CreateTaskSetRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)]
):
    if len(request.title.strip()) < 4:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Task set title must be at least 4 characters long"
        )

    # Verify all tasks exist and belong to the current user
    if request.task_ids:
        task_ids_tuple = tuple(request.task_ids)
        stmt = select(Parsons).where(Parsons.id.in_(task_ids_tuple))
        result = await db.execute(stmt)
        tasks = result.scalars().all()

        if len(tasks) != len(request.task_ids):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="One or more tasks not found"
            )

    # Check if title is unique for this teacher
    stmt = select(TaskSet).where(
        TaskSet.title == request.title,
        TaskSet.teacher_id == current_user.id
    )
    result = await db.execute(stmt)
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"You already have a task set with the title '{request.title}'. Please use a different title."
        )

    # Parse opening date if provided
    opens_at = None
    if request.opens_at:
        try:
            opens_at = datetime.fromisoformat(request.opens_at.replace('Z', '+00:00'))
        except (ValueError, AttributeError):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid opening date format"
            )

    # Parse expiration date if provided
    expires_at = None
    if request.expires_at:
        try:
            expires_at = datetime.fromisoformat(request.expires_at.replace('Z', '+00:00'))
        except (ValueError, AttributeError):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid expiration date format"
            )

    _validate_task_set_dates(opens_at, expires_at)

    base_slug = generate_slug(request.title)
    unique_link_code = base_slug
    suffix = 1
    while True:
        stmt = select(TaskSet).where(
            TaskSet.teacher_id == current_user.id,
            TaskSet.unique_link_code == unique_link_code,
        )
        result = await db.execute(stmt)
        if not result.scalar_one_or_none():
            break
        unique_link_code = f"{base_slug}{suffix}"
        suffix += 1

    # Create the task set
    task_set = TaskSet(
        teacher_id=current_user.id,
        title=request.title,
        student_description=request.student_description,
        teacher_description=request.teacher_description,
        unique_link_code=unique_link_code,
        opens_at=opens_at,
        expires_at=expires_at
    )

    db.add(task_set)
    await db.flush()

    for task_id in request.task_ids:
        task_set_item = TaskSetItem(
            task_set_id=task_set.id,
            task_id=task_id
        )
        db.add(task_set_item)

    await db.commit()
    await db.refresh(task_set)

    return TaskSetResponse(
        id=task_set.id,
        title=task_set.title,
        unique_link_code=task_set.unique_link_code,
        teacher_id=task_set.teacher_id,
        owner_username=current_user.username,
        student_description=task_set.student_description,
        teacher_description=task_set.teacher_description,
        created_at=task_set.created_at.isoformat(),
        opens_at=task_set.opens_at.isoformat() if task_set.opens_at else None,
        expires_at=task_set.expires_at.isoformat() if task_set.expires_at else None
    )


@router.patch("/api/my_sets/{task_set_id}/expires_at")
async def update_task_set_expires_at(
    task_set_id: int,
    request: UpdateExpiresAtRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    task_set = await get_task_set_or_404(db, TaskSet, task_set_id)
    if task_set.teacher_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No permission to modify this task set")

    if request.expires_at:
        try:
            expires_at = datetime.fromisoformat(request.expires_at.replace('Z', '+00:00'))
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid date format")
        _validate_task_set_dates(task_set.opens_at, expires_at)
        task_set.expires_at = expires_at
    else:
        task_set.expires_at = None

    await db.commit()
    return {"expires_at": task_set.expires_at.isoformat() if task_set.expires_at else None}


@router.patch("/api/my_sets/{task_set_id}/opens_at")
async def update_task_set_opens_at(
    task_set_id: int,
    request: UpdateOpensAtRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    task_set = await get_task_set_or_404(db, TaskSet, task_set_id)
    if task_set.teacher_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No permission to modify this task set")

    if request.opens_at:
        try:
            opens_at = datetime.fromisoformat(request.opens_at.replace('Z', '+00:00'))
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid date format")
        _validate_task_set_dates(opens_at, task_set.expires_at)
        task_set.opens_at = opens_at
    else:
        task_set.opens_at = None

    await db.commit()
    return {"opens_at": task_set.opens_at.isoformat() if task_set.opens_at else None}


@router.delete("/api/my_sets/{task_set_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task_set(
    task_set_id: int,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    task_set = await get_task_set_or_404(db, TaskSet, task_set_id)

    if task_set.teacher_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have permission to delete this task set")

    enrolled_stmt = (
        select(func.count(StudentTaskSetEnrollment.id))
        .where(StudentTaskSetEnrollment.task_set_id == task_set_id)
    )
    enrolled_count = (await db.execute(enrolled_stmt)).scalar() or 0
    if enrolled_count > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This task set cannot be deleted because students have already joined it.",
        )

    await db.execute(delete(TaskSet).where(TaskSet.id == task_set_id))
    await db.commit()


@router.get("/api/my_sets/{task_set_id}/viewers", response_model=list[TaskSetViewerResponse])
async def list_task_set_viewers(
    task_set_id: int,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)]
):
    task_set = await get_task_set_or_404(db, TaskSet, task_set_id)
    await require_task_set_view_access(task_set, current_user, db)

    stmt = (
        select(TaskSetViewer, Teacher)
        .join(Teacher, Teacher.id == TaskSetViewer.teacher_id)
        .where(TaskSetViewer.task_set_id == task_set_id)
        .order_by(Teacher.username.asc())
    )
    result = await db.execute(stmt)
    viewers = result.all()

    return [
        TaskSetViewerResponse(
            id=viewer.id,
            task_set_id=viewer.task_set_id,
            teacher_id=teacher.id,
            username=teacher.username,
            email=teacher.email,
            created_at=viewer.created_at.isoformat(),
        )
        for viewer, teacher in viewers
    ]


@router.post("/api/my_sets/{task_set_id}/viewers", response_model=TaskSetViewerResponse)
async def add_task_set_viewer(
    task_set_id: int,
    request: TaskSetViewerRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)]
):
    identifier = request.identifier.strip()
    if not identifier:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="username or email is required"
        )

    task_set = await get_task_set_or_404(db, TaskSet, task_set_id)

    if task_set.teacher_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to modify this task set"
        )

    teacher_result = await db.execute(
        select(Teacher).where(
            (Teacher.username == identifier) | (Teacher.email == identifier)
        )
    )
    teacher = teacher_result.scalar_one_or_none()

    if not teacher or not teacher.is_active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Teacher not found"
        )

    if teacher.id == task_set.teacher_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Task list owner already has access"
        )

    existing_result = await db.execute(
        select(TaskSetViewer).where(
            TaskSetViewer.task_set_id == task_set_id,
            TaskSetViewer.teacher_id == teacher.id
        )
    )
    existing = existing_result.scalar_one_or_none()

    if existing:
        return TaskSetViewerResponse(
            id=existing.id,
            task_set_id=existing.task_set_id,
            teacher_id=teacher.id,
            username=teacher.username,
            email=teacher.email,
            created_at=existing.created_at.isoformat(),
        )

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
    db: Annotated[AsyncSession, Depends(get_db)]
):
    task_set = await get_task_set_or_404(db, TaskSet, task_set_id)

    if task_set.teacher_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to modify this task set"
        )

    if teacher_id == task_set.teacher_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot remove access from the task set owner"
        )

    delete_stmt = delete(TaskSetViewer).where(
        TaskSetViewer.task_set_id == task_set_id,
        TaskSetViewer.teacher_id == teacher_id
    )
    delete_result = await db.execute(delete_stmt)

    if delete_result.rowcount == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Viewer not found"
        )

    await db.commit()
    return {"status": "success"}


@router.get("/api/my_sets/{task_set_id}/students", response_model=list[StudentInTaskSetResponse])
async def get_task_set_students(
    task_set_id: int,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)]
):
    """Get all students who have attempted at least one task in this task set."""
    # Verify task set exists and belongs to current user
    task_set = await get_task_set_or_404(db, TaskSet, task_set_id)
    await require_task_set_view_access(task_set, current_user, db)

    task_ids_stmt = (
        select(TaskSetItem.task_id)
        .where(TaskSetItem.task_set_id == task_set_id)
        .order_by(TaskSetItem.id.asc())
    )

    async def _handler(task_ids):
        task_completion_columns = [
            func.max(
                case(
                    (and_(StudentTaskEnrollment.task_id == task_id, TaskAttempt.success.is_(True)), 1),
                    else_=0,
                )
            ).label(f'task_{task_id}_completed')
            for task_id in task_ids
        ]

        task_attempt_count_columns = [
            func.count(
                case(
                    (StudentTaskEnrollment.task_id == task_id, TaskAttempt.id),
                    else_=None,
                )
            ).label(f'task_{task_id}_attempts')
            for task_id in task_ids
        ]

        task_started_columns = [
            func.max(
                case(
                    (StudentTaskEnrollment.task_id == task_id, 1),
                    else_=0,
                )
            ).label(f'task_{task_id}_started')
            for task_id in task_ids
        ]

        stmt = (
            select(
                Student.id,
                Student.username,
                Student.email,
                StudentTaskSetEnrollment.enrolled_at.label('started_at'),
                func.max(TaskAttempt.completed_at).label('last_activity_at'),
                func.count(TaskAttempt.id).label('total_attempts'),
                func.count(func.distinct(TaskAttempt.task_id)).label('tasks_attempted'),
                *task_completion_columns,
                *task_attempt_count_columns,
                *task_started_columns,
            )
            .join(StudentTaskSetEnrollment, (StudentTaskSetEnrollment.student_id == Student.id) & (StudentTaskSetEnrollment.task_set_id == task_set_id))
            .outerjoin(StudentTaskEnrollment, and_(
                StudentTaskEnrollment.student_id == Student.id,
                StudentTaskEnrollment.task_set_id == task_set_id,
                StudentTaskEnrollment.task_id.in_(task_ids),
            ))
            .outerjoin(TaskAttempt, and_(
                TaskAttempt.student_task_enrollment_id == StudentTaskEnrollment.id,
                TaskAttempt.student_id == Student.id,
            ))
            .where(Student.username.isnot(None))
            .group_by(Student.id, Student.username, Student.email, StudentTaskSetEnrollment.enrolled_at)
            .order_by(func.max(TaskAttempt.completed_at).desc())
        )

        result = await db.execute(stmt)
        students = result.mappings().all()

        return [
            StudentInTaskSetResponse(
                student_id=student['id'],
                username=student['username'],
                email=student['email'],
                started_at=student['started_at'].isoformat(),
                last_activity_at=student['last_activity_at'].isoformat() if student['last_activity_at'] else student['started_at'].isoformat(),
                total_attempts=student['total_attempts'],
                tasks_attempted=student['tasks_attempted'],
                completed_tasks=sum(int(student[f'task_{task_id}_completed'] or 0) for task_id in task_ids),
                task_completion_flags=[int(student[f'task_{task_id}_completed'] or 0) for task_id in task_ids],
                task_attempts=[int(student[f'task_{task_id}_attempts'] or 0) for task_id in task_ids],
                task_started_flags=[int(student[f'task_{task_id}_started'] or 0) for task_id in task_ids],
            )
            for student in students
        ]

    return await run_with_task_ids_or_empty(db, task_ids_stmt, _handler)


@router.post("/api/my_sets/{task_set_id}/initial-events-export")
async def export_initial_events(
    task_set_id: int,
    request: InitialEventsExportRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    task_set = await get_task_set_or_404(db, TaskSet, task_set_id)
    await require_task_set_view_access(task_set, current_user, db)

    requested_ids = list(dict.fromkeys(request.task_ids))
    if not requested_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Select at least one task")

    tasks_result = await db.execute(
        select(Parsons, TaskSetItem.id)
        .join(TaskSetItem, TaskSetItem.task_id == Parsons.id)
        .where(TaskSetItem.task_set_id == task_set_id, Parsons.id.in_(requested_ids))
        .order_by(TaskSetItem.id.asc())
    )
    task_rows = tasks_result.all()
    if len(task_rows) != len(requested_ids):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="One or more tasks are not in this task set")

    teacher = await db.get(Teacher, task_set.teacher_id)
    students_result = await db.execute(
        select(Student, StudentTaskSetEnrollment.enrolled_at)
        .join(StudentTaskSetEnrollment, StudentTaskSetEnrollment.student_id == Student.id)
        .where(StudentTaskSetEnrollment.task_set_id == task_set_id)
        .order_by(Student.id.asc())
    )
    students = students_result.all()
    archive = io.BytesIO()
    generation_date = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    set_name = _safe_filename_part(task_set.title, "taskSet")
    teacher_name = _safe_filename_part(teacher.username if teacher else "teacher", "teacher")

    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for task, _ in task_rows:
            student_ids = [student.id for student, _ in students]
            enrollment_result = await db.execute(
                select(StudentTaskEnrollment)
                .where(
                    StudentTaskEnrollment.task_set_id == task_set_id,
                    StudentTaskEnrollment.task_id == task.id,
                    StudentTaskEnrollment.student_id.in_(student_ids),
                )
            ) if student_ids else None
            enrollments = enrollment_result.scalars().all() if enrollment_result else []
            enrollment_by_student = {enrollment.student_id: enrollment for enrollment in enrollments}
            rows = []

            for student, _ in students:
                enrollment = enrollment_by_student.get(student.id)
                if not enrollment:
                    continue
                attempts_result = await db.execute(
                    select(TaskAttempt)
                    .where(TaskAttempt.student_task_enrollment_id == enrollment.id)
                    .where(TaskAttempt.completed_at.isnot(None))
                    .order_by(TaskAttempt.completed_at.asc(), TaskAttempt.id.asc())
                    .limit(1)
                )
                first_attempt = attempts_result.scalar_one_or_none()
                if not first_attempt:
                    continue

                sessions_result = await db.execute(
                    select(TaskSession)
                    .where(TaskSession.student_task_enrollment_id == enrollment.id)
                    .where(TaskSession.entered_at <= first_attempt.completed_at)
                    .order_by(TaskSession.entered_at.asc(), TaskSession.id.asc())
                )
                sessions = sessions_result.scalars().all()
                starting_time = _csv_datetime(sessions[0].entered_at if sessions else enrollment.started_at)
                first_attempt_time = _csv_datetime(first_attempt.completed_at)
                event_rows = []

                for session in sessions:
                    if session.id != sessions[0].id:
                        event_rows.append((session.entered_at, "return", ["", "", "", "", "", "", "", "", ""]))
                    if session.exited_at and session.exited_at <= first_attempt.completed_at:
                        event_rows.append((session.exited_at, "exit", ["", "", "", "", "", "", "", "", ""]))

                moves_result = await db.execute(
                    select(MoveEvent)
                    .where(MoveEvent.attempt_id == first_attempt.id)
                    .where(MoveEvent.event_time <= first_attempt.completed_at)
                )
                for move in moves_result.scalars().all():
                    event_rows.append((move.event_time, "move", [
                        move.block_id, move.from_container, move.to_container,
                        str(move.from_index), str(move.to_index), str(move.from_indent), str(move.to_indent), "", "",
                    ]))
                edits_result = await db.execute(
                    select(EditEvent)
                    .where(EditEvent.attempt_id == first_attempt.id)
                    .where(EditEvent.event_time <= first_attempt.completed_at)
                )
                for edit in edits_result.scalars().all():
                    event_rows.append((edit.event_time, "edit", [edit.block_id, "", "", "", "", "", "", str(edit.blank_index), edit.value]))

                for event_time, event_type, specific in sorted(event_rows, key=lambda event: (event[0], event[1])):
                    rows.append([
                        str(student.id), starting_time, first_attempt_time, event_type,
                        _csv_datetime(event_time), *specific,
                    ])

            filename = (
                f"{set_name}_{teacher_name}_{_safe_filename_part(task.title, 'task')}_"
                f"taskID_{task.id}_{generation_date}.csv"
            )
            zip_file.writestr(filename, _initial_events_csv(rows))

    archive.seek(0)
    zip_name = f"{set_name}_{teacher_name}_INITIAL_EVENTS_{generation_date}.zip"
    return Response(
        content=archive.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{zip_name}"'},
    )


@router.delete("/api/my_sets/{task_set_id}/students/{student_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_student_from_task_set(
    task_set_id: int,
    student_id: int,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
	# Removes students enrollment and attempts from the task set, does NOT delete the student account.
    task_set = await get_task_set_or_404(db, TaskSet, task_set_id)

    if task_set.teacher_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to modify this task set",
        )

    student_result = await db.execute(select(Student).where(Student.id == student_id))
    student = student_result.scalar_one_or_none()
    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student not found",
        )

    enrollment_result = await db.execute(
        select(StudentTaskSetEnrollment.id).where(
            StudentTaskSetEnrollment.student_id == student.id,
            StudentTaskSetEnrollment.task_set_id == task_set_id,
        )
    )
    task_set_enrollment_id = enrollment_result.scalar_one_or_none()
    if task_set_enrollment_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student is not enrolled in this task set",
        )

    enrollment_ids_subquery = select(StudentTaskEnrollment.id).where(
        StudentTaskEnrollment.student_id == student.id,
        StudentTaskEnrollment.task_set_id == task_set_id,
    )
    attempt_ids_subquery = select(TaskAttempt.id).where(
        TaskAttempt.student_task_enrollment_id.in_(enrollment_ids_subquery)
    )

    await db.execute(delete(MoveEvent).where(MoveEvent.attempt_id.in_(attempt_ids_subquery)))
    await db.execute(delete(EditEvent).where(EditEvent.attempt_id.in_(attempt_ids_subquery)))
    await db.execute(delete(TaskAttempt).where(TaskAttempt.id.in_(attempt_ids_subquery)))
    await db.execute(
        delete(TaskSession).where(
            TaskSession.student_task_enrollment_id.in_(enrollment_ids_subquery)
        )
    )
    await db.execute(
        delete(StudentTaskEnrollment).where(
            StudentTaskEnrollment.id.in_(enrollment_ids_subquery)
        )
    )
    await db.execute(
        delete(StudentTaskSetEnrollment).where(
            StudentTaskSetEnrollment.id == task_set_enrollment_id
        )
    )
    await db.commit()

STRUGGLING_THRESHOLD = 5


@router.get("/api/my_sets/{task_set_id}/heatmap")
async def get_heatmap(
    task_set_id: int,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    task_set = await get_task_set_or_404(db, TaskSet, task_set_id)
    await require_task_set_view_access(task_set, current_user, db)

    tasks_result = await db.execute(
        select(Parsons, TaskSetItem.is_hidden)
        .join(TaskSetItem, TaskSetItem.task_id == Parsons.id)
        .where(TaskSetItem.task_set_id == task_set_id, TaskSetItem.is_hidden == False)
        .order_by(TaskSetItem.id.asc())
    )
    tasks = tasks_result.all()

    students_result = await db.execute(
        select(Student.id, Student.username)
        .join(StudentTaskSetEnrollment, StudentTaskSetEnrollment.student_id == Student.id)
        .where(StudentTaskSetEnrollment.task_set_id == task_set_id)
        .order_by(Student.username.asc())
    )
    students = students_result.all()

    attempts_result = await db.execute(
        select(TaskAttempt)
        .join(StudentTaskEnrollment, StudentTaskEnrollment.id == TaskAttempt.student_task_enrollment_id)
        .where(StudentTaskEnrollment.task_set_id == task_set_id)
    )
    attempts = attempts_result.scalars().all()

    enrollments_result = await db.execute(
        select(StudentTaskEnrollment)
        .where(StudentTaskEnrollment.task_set_id == task_set_id)
    )
    enrollments = enrollments_result.scalars().all()
    enrollment_map = {(e.student_id, e.task_id): e for e in enrollments}

    attempt_map: dict = defaultdict(list)
    for a in attempts:
        attempt_map[(a.student_id, a.task_id)].append(a)

    student_rows = []
    for student in students:
        cells = []
        for task, _ in tasks:
            student_attempts = attempt_map[(student.id, task.id)]
            enrollment = enrollment_map.get((student.id, task.id))
            has_started = enrollment is not None
            total = len(student_attempts)
            completed = any(a.success for a in student_attempts)
            last = max(
                (a.completed_at for a in student_attempts if a.completed_at),
                default=enrollment.started_at if enrollment else None,
            )

            if completed:
                cell_status = "completed"
            elif total >= STRUGGLING_THRESHOLD:
                cell_status = "struggling"
            elif total > 0 or has_started:
                cell_status = "in_progress"
            else:
                cell_status = "not_started"

            cells.append({
                "task_id": task.id,
                "status": cell_status,
                "attempts": total,
                "last_active_at": last.isoformat() if last else None,
            })

        student_rows.append({"id": student.id, "username": student.username, "cells": cells})

    return {
        "tasks": [{"id": t.id, "title": t.title, "is_hidden": is_hidden} for t, is_hidden in tasks],
        "students": student_rows,
    }
