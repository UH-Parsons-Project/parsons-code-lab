import json
from collections import defaultdict
from datetime import datetime
import re
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
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
    StudentInTaskSetResponse,
    TaskResponse,
    TaskSetResponse,
    TaskSetTaskResponse,
    TaskSetViewerRequest,
    TaskSetViewerResponse,
    TeacherLookupResponse,
    UpdateExpiresAtRequest,
    UpdateModelAnswerRequest,
)
from ...utils.task import _resolve_task_type, is_task_editable
from ...utils.taskset import has_task_set_view_access, require_task_set_view_access
from backend.utils import generate_slug
from ..utils.commons import (
    get_task_set_or_404,
    run_with_task_ids_or_empty,
)

router = APIRouter()


def _sanitize_model_answer_code(code: str | None) -> str:
    if not code:
        return ""

    normalized = code.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized:
        return ""

    sanitized = re.sub(r"<input[^>]*class=['\"]text-box['\"][^>]*>", "", normalized, flags=re.IGNORECASE)
    sanitized = sanitized.replace("</input>", "")
    sanitized = re.sub(r"<input[^>]*>", "", sanitized, flags=re.IGNORECASE)

    def _replace_blank_markers(match: re.Match[str]) -> str:
        marker = match.group(0)
        if marker.lower().startswith("#blank"):
            suffix = marker[6:].strip()
            if suffix:
                return suffix
            return ""
        return marker

    sanitized = re.sub(r"#blank\w*", _replace_blank_markers, sanitized)
    return sanitized.strip()


@router.get("/api/tasks/{task_id}", response_model=TaskResponse)
async def get_task(
    task_id: int,
    current_user: OptionalCurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    stmt = select(Parsons).where(Parsons.id == task_id)
    result = await db.execute(stmt)
    task = result.scalar_one_or_none()

    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task with id {task_id} not found",
        )

    if not task.is_public:
        if not current_user or (
            not current_user.is_admin_teacher
            and current_user.id != task.created_by_teacher_id
        ):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Task with id {task_id} not found",
            )

    model_answer_code = None
    if current_user:
        model_answer_result = await db.execute(
            select(ModelAnswer.answer_code).where(ModelAnswer.parsons_id == task.id)
        )
        model_answer_code = model_answer_result.scalar_one_or_none()

    return TaskResponse(
        id=task.id,
        title=task.title,
        task_instructions=task.task_instructions,
        description=task.description,
        task_type=task.task_type,
        code_blocks=task.code_blocks,
        correct_solution=task.correct_solution,
        is_public=task.is_public,
        faded=task.faded,
        created_at=task.created_at.isoformat(),
        model_answer=model_answer_code,
    )


@router.get("/api/my_tasks")
async def list_my_tasks(current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    tasks_result = await db.execute(
        select(Parsons)
        .where(Parsons.created_by_teacher_id == current_user.id)
        .order_by(Parsons.created_at.desc())
    )
    tasks = tasks_result.scalars().all()

    if not tasks:
        return []

    task_ids = [t.id for t in tasks]

    other_sets_result = await db.execute(
        select(TaskSetItem.task_id)
        .join(TaskSet, TaskSet.id == TaskSetItem.task_set_id)
        .where(TaskSetItem.task_id.in_(task_ids), TaskSet.teacher_id != current_user.id)
        .distinct()
    )
    in_other_sets = set(other_sets_result.scalars().all())

    enrolled_sets_result = await db.execute(
        select(TaskSetItem.task_id)
        .join(TaskSet, TaskSet.id == TaskSetItem.task_set_id)
        .join(StudentTaskSetEnrollment, StudentTaskSetEnrollment.task_set_id == TaskSet.id)
        .where(TaskSetItem.task_id.in_(task_ids), TaskSet.teacher_id == current_user.id)
        .distinct()
    )
    in_enrolled_sets = set(enrolled_sets_result.scalars().all())

    non_editable = in_other_sets | in_enrolled_sets

    return [
        {
            "id": t.id,
            "title": t.title,
            "task_type": t.task_type,
            "created_at": t.created_at.isoformat(),
            "editable": t.id not in non_editable,
            "is_public": t.is_public,
        }
        for t in tasks
    ]


@router.get("/api/tasks")
async def list_tasks(current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    stmt = (
        select(Parsons, Teacher.username, TeacherFavoriteTask.id)
        .join(Teacher, Teacher.id == Parsons.created_by_teacher_id)
        .outerjoin(
            TeacherFavoriteTask,
            (TeacherFavoriteTask.task_id == Parsons.id)
            & (TeacherFavoriteTask.teacher_id == current_user.id),
        )
    )

    if not current_user.is_admin_teacher:
        stmt = stmt.where(
            or_(
                Parsons.is_public,
                Parsons.created_by_teacher_id == current_user.id,
            )
        )

    stmt = stmt.order_by(Parsons.created_at.desc())
    result = await db.execute(stmt)
    tasks = result.all()

    task_set = []
    for task, creator_username, favorite_id in tasks:
        instructions_text = ""
        try:
            instructions_data = json.loads(task.task_instructions)
            if isinstance(instructions_data, dict):
                instructions_text = instructions_data.get("task_instructions", "")
            else:
                instructions_text = str(instructions_data or "")
        except (json.JSONDecodeError, AttributeError):
            instructions_text = ""

        description_text = ""
        if isinstance(task.description, str):
            try:
                description_data = json.loads(task.description)
                if isinstance(description_data, dict):
                    description_text = description_data.get("description", task.description)
                else:
                    description_text = str(description_data or "")
            except (json.JSONDecodeError, TypeError):
                description_text = task.description

        task_set.append(
            {
                "id": task.id,
                "title": task.title,
                "task_instructions": instructions_text,
                "description": description_text,
                "task_type": task.task_type,
                "created_by_teacher_id": task.created_by_teacher_id,
                "creator_username": creator_username,
                "created_at": task.created_at.isoformat(),
                "is_favorite": favorite_id is not None,
                "is_public": task.is_public,
                "faded": task.faded,
            }
        )

    return task_set


@router.post("/api/tasks/{task_id}/favorite")
async def favorite_task(
    task_id: int,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    task_result = await db.execute(select(Parsons.id).where(Parsons.id == task_id, Parsons.is_public))
    if task_result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task with id {task_id} not found",
        )

    existing_result = await db.execute(
        select(TeacherFavoriteTask).where(
            TeacherFavoriteTask.teacher_id == current_user.id,
            TeacherFavoriteTask.task_id == task_id,
        )
    )
    existing = existing_result.scalar_one_or_none()
    if existing is None:
        favorite = TeacherFavoriteTask(teacher_id=current_user.id, task_id=task_id)
        db.add(favorite)
        await db.commit()

    return {"task_id": task_id, "is_favorite": True}


@router.delete("/api/tasks/{task_id}/favorite")
async def unfavorite_task(
    task_id: int,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    delete_stmt = delete(TeacherFavoriteTask).where(
        TeacherFavoriteTask.teacher_id == current_user.id,
        TeacherFavoriteTask.task_id == task_id,
    )
    result = await db.execute(delete_stmt)

    if result.rowcount == 0:
        return {"task_id": task_id, "is_favorite": False}

    await db.commit()
    return {"task_id": task_id, "is_favorite": False}


@router.post("/api/problems")
async def create_problem(
    request: CreateProblemRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)]
):
    task_title = request.taskTitle.strip()
    solution_code = request.solutionCode.replace("\r\n", "\n").replace("\r", "\n").strip()
    description = request.description.strip()
    start_description = request.startDescription.strip()
    tests = request.tests.strip()
    custom_error_messages = request.customErrorMessages.strip() if request.customErrorMessages else None
    blocks, correct_order, has_faded = _build_blocks_from_repr(
        source_for_blocks,
        solution_code,
    )

    if not task_title or not solution_code or not description or not start_description:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="taskTitle, description, startDescription and solutionCode are required",
        )
    if request.eval_type == "unit_test" and not tests:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="tests are required for unit_test evaluation type",
        )

    parsons_repr = (request.parsonsRepr or "").replace("\r\n", "\n").replace("\r", "\n")
    if not parsons_repr.strip():
        correct_order = [block["id"] for block in blocks]
    source_for_blocks = parsons_repr if parsons_repr.strip() else solution_code
    is_public = True if request.is_public is None else request.is_public

    lines = [line for line in source_for_blocks.split("\n") if line.strip()]
    if not lines:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="solutionCode must contain at least one non-empty line",
        )

    first_code_line = lines[0].strip()
    if " #" in first_code_line:
        first_code_line = first_code_line.split(" #", 1)[0].rstrip()

    import re

    if request.eval_type == "unit_test":
        if not (first_code_line.startswith("def ") or first_code_line.startswith("class ")):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The first non-empty solution line must start with def or class",
            )
        header_match = re.match(r"^(def|class)\s+([A-Za-z_][A-Za-z0-9_]*)", first_code_line)
        function_name = header_match.group(2) if header_match else "custom_task"
        function_header = first_code_line
    else:
        function_name = ""
        function_header = ""
    final_title = task_title

    existing_task_stmt = select(Parsons).where(Parsons.title == final_title)
    existing_task_result = await db.execute(existing_task_stmt)
    if existing_task_result.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Exercise called '{final_title}' already exists. Choose a different task name.",
        )

    given_indent_re = re.compile(r"#(\d+)given\s*")
    preplace_re = re.compile(r"#preplace\s*")
    blank_marker_re = re.compile(r"\s#blank[^#]*")

    blocks = []
    has_faded = False
    for line_index, line in enumerate(lines, start=1):
        given_match = given_indent_re.search(line)
        preplace_match = preplace_re.search(line)
        if given_match:
            indent_count = int(given_match.group(1)) * 4
        else:
            indent_count = len(line) - len(line.lstrip())

        line_without_given = given_indent_re.sub("", line)
        line_without_preplace = preplace_re.sub("", line_without_given)
        line_without_blank_markers = blank_marker_re.sub("", line_without_preplace)
        sanitized_input_line = re.sub(r"<input[^>]*>(?:</input>)?", "!BLANK", line_without_blank_markers, flags=re.IGNORECASE)
        sanitized_input_line = re.sub(r"<input[^>]*/>", "!BLANK", sanitized_input_line, flags=re.IGNORECASE)
        sanitized_input_line = re.sub(r"<[^>]+>", "", sanitized_input_line)
        stripped_line = sanitized_input_line.strip()
        is_faded = "!BLANK" in stripped_line
        if is_faded:
            has_faded = True

        clean_code = stripped_line.replace("!BLANK", "___")
        blocks.append(
            {
                "id": f"block_{line_index}",
                "code": clean_code,
                "indent": indent_count // 4,
                "faded": is_faded,
                "given": preplace_match is not None,
            }
        )

    requested_task_type = _resolve_task_type(request.task_type, has_faded)

    examples_text = request.examples.strip() if request.examples else ""

    task_instructions_payload = json.dumps(
        {
            "function_name": function_name,
            "task_instructions": description,
            "examples": examples_text,
        }
    )

    task = Parsons(
        created_by_teacher_id=current_user.id,
        title=final_title,
        task_instructions=task_instructions_payload,
        description=start_description,
        task_type=requested_task_type,
        code_blocks={
            "blocks": blocks,
            "function_header": function_header,
        },
        correct_solution={
            "correct_order": correct_order,
            "teacher_tests": tests,
            "solution_code": solution_code,
            "custom_error_messages": custom_error_messages,
            "eval_type": request.eval_type,
            "expected_output": request.expected_output,
            "require_indentation": request.require_indentation,
        },
        is_public=is_public,
        faded=has_faded,
    )

    db.add(task)
    await db.flush()

    model_answer_code = (request.modelAnswerCode or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    model_answer = ModelAnswer(
        parsons_id=task.id,
        created_by_teacher_id=current_user.id,
        answer_code=model_answer_code or solution_code,
    )
    db.add(model_answer)
    await db.commit()
    await db.refresh(task)

    return {"id": task.id, "message": "Problem created"}


@router.get("/api/problems/{task_id}/editable")
async def check_task_editable(
    task_id: int,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    task_result = await db.execute(select(Parsons).where(Parsons.id == task_id))
    task = task_result.scalar_one_or_none()

    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Task {task_id} not found")

    if task.created_by_teacher_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have permission to check this task")

    editable = await is_task_editable(task_id, current_user.id, db)
    return {"task_id": task_id, "editable": editable}


@router.get("/api/problems/{task_id}/model-answer")
async def get_model_answer(
    task_id: int,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    task_result = await db.execute(select(Parsons).where(Parsons.id == task_id))
    task = task_result.scalar_one_or_none()

    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Task {task_id} not found")

    if task.created_by_teacher_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have permission to edit this task")

    model_answer_result = await db.execute(select(ModelAnswer.answer_code).where(ModelAnswer.parsons_id == task_id))
    model_answer_code = model_answer_result.scalar_one_or_none()
    return {"task_id": task_id, "model_answer": _sanitize_model_answer_code(model_answer_code) or ""}


@router.put("/api/problems/{task_id}/model-answer")
async def update_model_answer(
    task_id: int,
    request: UpdateModelAnswerRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    task_result = await db.execute(select(Parsons).where(Parsons.id == task_id))
    task = task_result.scalar_one_or_none()

    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Task {task_id} not found")

    if task.created_by_teacher_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have permission to edit this task")

    model_answer_code = _sanitize_model_answer_code(request.modelAnswerCode)
    model_answer_result = await db.execute(select(ModelAnswer).where(ModelAnswer.parsons_id == task_id))
    model_answer = model_answer_result.scalar_one_or_none()

    if model_answer:
        model_answer.answer_code = model_answer_code or ""
    else:
        model_answer = ModelAnswer(
            parsons_id=task_id,
            created_by_teacher_id=current_user.id,
            answer_code=model_answer_code or "",
        )
        db.add(model_answer)

    await db.commit()
    return {"id": task.id, "message": "Model answer updated"}


@router.put("/api/problems/{task_id}")
async def update_problem(
    task_id: int,
    request: CreateProblemRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)]
):
    task_result = await db.execute(select(Parsons).where(Parsons.id == task_id))
    task = task_result.scalar_one_or_none()
    blocks, correct_order, has_faded = _build_blocks_from_repr(
        source_for_blocks,
        solution_code,
    )

    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Task {task_id} not found")

    if task.created_by_teacher_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have permission to edit this task")

    if not await is_task_editable(task_id, current_user.id, db):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This task cannot be edited because it is used in a task set with enrolled students or in another teacher's task set.",
        )

    task_title = request.taskTitle.strip()
    solution_code = request.solutionCode.replace("\r\n", "\n").replace("\r", "\n").strip()
    description = request.description.strip()
    start_description = request.startDescription.strip()
    tests = request.tests.strip()
    custom_error_messages = request.customErrorMessages.strip() if request.customErrorMessages else None

    if not task_title or not solution_code or not description or not start_description:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="taskTitle, description, startDescription and solutionCode are required",
        )
    if request.eval_type == "unit_test" and not tests:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="tests are required for unit_test evaluation type",
        )

    parsons_repr = (request.parsonsRepr or "").replace("\r\n", "\n").replace("\r", "\n")
    source_for_blocks = parsons_repr if parsons_repr.strip() else solution_code

    lines = [line for line in source_for_blocks.split("\n") if line.strip()]
    if not lines:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="solutionCode must contain at least one non-empty line",
        )

    first_code_line = lines[0].strip()
    if " #" in first_code_line:
        first_code_line = first_code_line.split(" #", 1)[0].rstrip()

    if request.eval_type == "unit_test":
        if not (first_code_line.startswith("def ") or first_code_line.startswith("class ")):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The first non-empty solution line must start with def or class",
            )
        header_match = re.match(r"^(def|class)\s+([A-Za-z_][A-Za-z0-9_]*)", first_code_line)
        function_name = header_match.group(2) if header_match else "custom_task"
        function_header = first_code_line
    else:
        function_name = ""
        function_header = ""
    final_title = task_title

    if task.title != final_title:
        existing_task_stmt = select(Parsons).where(Parsons.title == final_title, Parsons.id != task_id)
        existing_task_result = await db.execute(existing_task_stmt)
        if existing_task_result.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Exercise called '{final_title}' already exists. Choose a different task name.",
            )

    given_indent_re = re.compile(r"#(\d+)given\s*")
    preplace_re = re.compile(r"#preplace\s*")
    blank_marker_re = re.compile(r"\s#blank[^#]*")

    blocks = []
    has_faded = False
    for line_index, line in enumerate(lines, start=1):
        given_match = given_indent_re.search(line)
        preplace_match = preplace_re.search(line)
        if given_match:
            indent_count = int(given_match.group(1)) * 4
        else:
            indent_count = len(line) - len(line.lstrip())

        line_without_given = given_indent_re.sub("", line)
        line_without_preplace = preplace_re.sub("", line_without_given)
        line_without_blank_markers = blank_marker_re.sub("", line_without_preplace)
        sanitized_input_line = re.sub(r"<input[^>]*>(?:</input>)?", "!BLANK", line_without_blank_markers, flags=re.IGNORECASE)
        sanitized_input_line = re.sub(r"<input[^>]*/>", "!BLANK", sanitized_input_line, flags=re.IGNORECASE)
        sanitized_input_line = re.sub(r"<[^>]+>", "", sanitized_input_line)
        stripped_line = sanitized_input_line.strip()
        is_faded = "!BLANK" in stripped_line
        if is_faded:
            has_faded = True

        clean_code = stripped_line.replace("!BLANK", "___")
        blocks.append(
            {
                "id": f"block_{line_index}",
                "code": clean_code,
                "indent": indent_count // 4,
                "faded": is_faded,
                "given": preplace_match is not None,
            }
        )

    requested_task_type = _resolve_task_type(request.task_type, has_faded)

    examples_text = request.examples.strip() if request.examples else ""

    task_instructions_payload = json.dumps(
        {
            "function_name": function_name,
            "task_instructions": description,
            "examples": examples_text,
        }
    )

    task.title = final_title
    task.task_instructions = task_instructions_payload
    task.description = start_description
    task.task_type = requested_task_type
    task.code_blocks = {"blocks": blocks, "function_header": function_header}
    task.correct_solution = {
        "correct_order": correct_order,
        "teacher_tests": tests,
        "solution_code": solution_code,
        "custom_error_messages": custom_error_messages,
        "eval_type": request.eval_type,
        "expected_output": request.expected_output,
        "require_indentation": request.require_indentation,
    }
    task.is_public = True if request.is_public is None else request.is_public
    task.faded = has_faded

    await db.commit()
    await db.refresh(task)

    return {"id": task.id, "message": "Problem updated"}

def _parse_blocks_from_repr(source_for_blocks: str, solution_code: str):
    given_indent_re = re.compile(r"#(\d+)given\s*")
    preplace_re = re.compile(r"#preplace\s*")
    blank_marker_re = re.compile(r"\s#blank[^#]*")

    lines = [line for line in source_for_blocks.split("\n") if line.strip()]
    blocks = []
    correct_order = []
    has_faded = False

    for line_index, line in enumerate(lines, start=1):
        given_match = given_indent_re.search(line)
        preplace_match = preplace_re.search(line)
    
    if given_match:
        indent_count = int(given_match.group(1)) * 4
        correct_order.append(f"block_{line_index}")
    else:
        indent_count = len(line) - len(line.lstrip())
    
    line = given_indent_re.sub("", line)
    line = preplace_re.sub("", line)
    line = blank_marker_re.sub("", line)

    line = re.sub(
        r"<input[^>]*>(?:</input>)?",
        "!BLANK",
        line,
        flags=re.IGNORECASE
    )
    line = re.sub(r"<input[^>]*/>", "!BLANK", line, flags=re.IGNORECASE)
    LINE = re.sub(r"<[^>]+>", "", line)

    clean_code = line.strip()
    is_faded = "!BLANK" in clean_code
    has_faded = has_faded or is_faded

    blocks.append({
        "id": f"block_{line_index}",
        "code": clean_code.replace("!BLANK", "___"),
        "indent": indent_count // 4,
        "faded": is_faded,
        "given": preplace_match is not None,
    })

    return blocks, correct_order, has_faded


@router.delete("/api/problems/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_problem(
    task_id: int,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    task_result = await db.execute(select(Parsons).where(Parsons.id == task_id))
    task = task_result.scalar_one_or_none()

    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Task {task_id} not found")

    if task.created_by_teacher_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have permission to delete this task")

    if not await is_task_editable(task_id, current_user.id, db):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This task cannot be deleted because it is used in a task set with enrolled students or in another teacher's task set.",
        )

    await db.execute(delete(Parsons).where(Parsons.id == task_id))
    await db.commit()
