"""
Unit tests for task/task-set CRUD introduced in the edit_task branch.

Covers:
  - DELETE /api/problems/{task_id}
  - PUT    /api/problems/{task_id}
  - GET    /api/problems/{task_id}/editable
  - DELETE /api/my_sets/{task_set_id}
"""

import pytest
import pytest_asyncio
from sqlalchemy import delete, select

from backend.teacher_auth import create_access_token
from backend.models import (
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
    Teacher,
)


def _auth(username: str) -> dict:
    return {"Authorization": f"Bearer {create_access_token({'sub': username})}"}


def _problem_payload(**overrides) -> dict:
    base = {
        "taskTitle": "My Test Task",
        "description": "Compute something.",
        "startDescription": "Practice functions.",
        "tests": "assert my_test_task(1) == 2",
        "solutionCode": "def my_test_task(x):\n    return x + 1",
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# Extra fixtures
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def other_teacher(db_session) -> Teacher:
    t = Teacher(username="otherteacher", email="other@example.com", is_active=True)
    t.set_password("password123")
    db_session.add(t)
    await db_session.commit()
    await db_session.refresh(t)
    return t


@pytest_asyncio.fixture
async def admin_teacher(db_session) -> Teacher:
    t = Teacher(
        username="adminteacher",
        email="admin@example.com",
        is_active=True,
        is_admin_teacher=True,
    )
    t.set_password("password123")
    db_session.add(t)
    await db_session.commit()
    await db_session.refresh(t)
    return t


@pytest_asyncio.fixture
async def task_in_other_teachers_set(db_session, task, other_teacher):
    """task belonging to test_teacher, but also added to other_teacher's task set."""
    ts = TaskSet(
        teacher_id=other_teacher.id,
        title="Other Set",
        unique_link_code="OTHER1",
    )
    db_session.add(ts)
    await db_session.flush()
    db_session.add(TaskSetItem(task_set_id=ts.id, task_id=task.id))
    await db_session.commit()
    await db_session.refresh(ts)
    return task, ts


# ---------------------------------------------------------------------------
# DELETE /api/problems/{task_id}
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestDeleteTask:
    async def test_success(self, client, task, test_teacher, db_session):
        r = await client.delete(f"/api/problems/{task.id}", headers=_auth(test_teacher.username))
        assert r.status_code == 204
        result = await db_session.execute(select(Parsons).where(Parsons.id == task.id))
        assert result.scalar_one_or_none() is None

    async def test_not_found(self, client, test_teacher):
        r = await client.delete("/api/problems/99999", headers=_auth(test_teacher.username))
        assert r.status_code == 404

    async def test_unauthorized(self, client, task):
        r = await client.delete(f"/api/problems/{task.id}")
        assert r.status_code == 401

    async def test_not_owner_gets_403(self, client, task, other_teacher):
        r = await client.delete(f"/api/problems/{task.id}", headers=_auth(other_teacher.username))
        assert r.status_code == 403

    async def test_blocked_when_students_enrolled_in_set(
        self, client, task_set_with_task, student_session, test_teacher
    ):
        _, task = task_set_with_task
        r = await client.delete(f"/api/problems/{task.id}", headers=_auth(test_teacher.username))
        assert r.status_code == 409

    async def test_blocked_when_in_other_teachers_set(
        self, client, task_in_other_teachers_set, test_teacher
    ):
        task, _ = task_in_other_teachers_set
        r = await client.delete(f"/api/problems/{task.id}", headers=_auth(test_teacher.username))
        assert r.status_code == 409

    async def test_admin_cannot_delete_others_task(
        self, client, task, admin_teacher
    ):
        r = await client.delete(f"/api/problems/{task.id}", headers=_auth(admin_teacher.username))
        assert r.status_code == 403


# ---------------------------------------------------------------------------
# PUT /api/problems/{task_id}
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestModelAnswerRetrieval:
    async def test_returns_stored_model_answer(self, client, task, test_teacher, db_session):
        ma = ModelAnswer(
            parsons_id=task.id,
            created_by_teacher_id=test_teacher.id,
            answer_code="stored answer",
        )
        db_session.add(ma)
        await db_session.commit()

        r = await client.get(f"/api/problems/{task.id}/model-answer", headers=_auth(test_teacher.username))
        assert r.status_code == 200
        assert r.json()["model_answer"] == "stored answer"


@pytest.mark.asyncio
class TestUpdateTask:
    async def test_success(self, client, task, test_teacher):
        payload = _problem_payload(
            taskTitle="Updated Title",
            solutionCode="def updated_fn(x):\n    return x + 1",
            tests="assert updated_fn(1) == 2",
        )
        r = await client.put(
            f"/api/problems/{task.id}",
            headers=_auth(test_teacher.username),
            json=payload,
        )
        assert r.status_code == 200
        assert r.json()["message"] == "Problem updated"

    async def test_changes_persisted_in_db(self, client, task, test_teacher, db_session):
        payload = _problem_payload(
            taskTitle="Persisted Update",
            solutionCode="def persisted(x):\n    return x * 3",
            tests="assert persisted(2) == 6",
        )
        await client.put(
            f"/api/problems/{task.id}",
            headers=_auth(test_teacher.username),
            json=payload,
        )
        await db_session.refresh(task)
        assert task.title == "Persisted Update"

    async def test_not_found(self, client, test_teacher):
        r = await client.put(
            "/api/problems/99999",
            headers=_auth(test_teacher.username),
            json=_problem_payload(),
        )
        assert r.status_code == 404

    async def test_unauthorized(self, client, task):
        r = await client.put(f"/api/problems/{task.id}", json=_problem_payload())
        assert r.status_code == 401

    async def test_not_owner_gets_403(self, client, task, other_teacher):
        r = await client.put(
            f"/api/problems/{task.id}",
            headers=_auth(other_teacher.username),
            json=_problem_payload(),
        )
        assert r.status_code == 403

    async def test_blocked_when_students_enrolled_in_set(
        self, client, task_set_with_task, student_session, test_teacher
    ):
        _, task = task_set_with_task
        r = await client.put(
            f"/api/problems/{task.id}",
            headers=_auth(test_teacher.username),
            json=_problem_payload(),
        )
        assert r.status_code == 409

    async def test_blocked_when_in_other_teachers_set(
        self, client, task_in_other_teachers_set, test_teacher
    ):
        task, _ = task_in_other_teachers_set
        r = await client.put(
            f"/api/problems/{task.id}",
            headers=_auth(test_teacher.username),
            json=_problem_payload(),
        )
        assert r.status_code == 409

    async def test_duplicate_title_rejected(self, client, task, private_task, test_teacher):
        payload = _problem_payload(
            taskTitle=private_task.title,
            solutionCode="def private_task_fn(x):\n    return x",
            tests="assert private_task_fn(1) == 1",
        )
        r = await client.put(
            f"/api/problems/{task.id}",
            headers=_auth(test_teacher.username),
            json=payload,
        )
        assert r.status_code == 400

    async def test_put_does_not_update_model_answer_by_default(self, client, task, test_teacher, db_session):
        ma = ModelAnswer(
            parsons_id=task.id,
            created_by_teacher_id=test_teacher.id,
            answer_code="old code",
        )
        db_session.add(ma)
        await db_session.commit()

        payload = _problem_payload(
            taskTitle="MA Update Task",
            solutionCode="def ma_update(x):\n    return x + 5",
            tests="assert ma_update(1) == 6",
            modelAnswerCode="def ma_update(x):\n    return x + 5",
        )
        r = await client.put(
            f"/api/problems/{task.id}",
            headers=_auth(test_teacher.username),
            json=payload,
        )
        assert r.status_code == 200
        await db_session.refresh(ma)
        assert ma.answer_code == "old code"

    async def test_model_answer_endpoint_updates_existing_model_answer(self, client, task, test_teacher, db_session):
        ma = ModelAnswer(
            parsons_id=task.id,
            created_by_teacher_id=test_teacher.id,
            answer_code="old code",
        )
        db_session.add(ma)
        await db_session.commit()

        r = await client.put(
            f"/api/problems/{task.id}/model-answer",
            headers=_auth(test_teacher.username),
            json=_problem_payload(modelAnswerCode="def ma_update(x):\n    return x + 5"),
        )
        assert r.status_code == 200
        await db_session.refresh(ma)
        assert ma.answer_code == "def ma_update(x):\n    return x + 5"

    async def test_creates_model_answer_when_missing(self, client, task, test_teacher, db_session):
        await db_session.execute(delete(ModelAnswer).where(ModelAnswer.parsons_id == task.id))
        await db_session.commit()

        payload = _problem_payload(
            taskTitle="No MA Task",
            solutionCode="def no_ma(x):\n    return x + 9",
            tests="assert no_ma(0) == 9",
        )
        # Create model answer explicitly via the dedicated endpoint
        r = await client.put(
            f"/api/problems/{task.id}/model-answer",
            headers=_auth(test_teacher.username),
            json=_problem_payload(modelAnswerCode="def no_ma(x):\n    return x + 9"),
        )
        assert r.status_code == 200
        result = await db_session.execute(
            select(ModelAnswer).where(ModelAnswer.parsons_id == task.id)
        )
        assert result.scalar_one_or_none() is not None

    async def test_model_answer_endpoint_strips_blank_markers_and_keeps_numeric_value(self, client, task, test_teacher, db_session):
        r = await client.put(
            f"/api/problems/{task.id}/model-answer",
            headers=_auth(test_teacher.username),
            json=_problem_payload(modelAnswerCode="def ma_update(x):\n    return #blank1"),
        )
        assert r.status_code == 200

        result = await db_session.execute(
            select(ModelAnswer).where(ModelAnswer.parsons_id == task.id)
        )
        saved_model_answer = result.scalar_one()
        assert saved_model_answer.answer_code == "def ma_update(x):\n    return 1"

    async def test_model_answer_endpoint_supports_standalone_payload(self, client, task, test_teacher, db_session):
        r = await client.put(
            f"/api/problems/{task.id}/model-answer",
            headers=_auth(test_teacher.username),
            json={"modelAnswerCode": "def standalone_ma(x):\n    return x + 10"},
        )
        assert r.status_code == 200
        result = await db_session.execute(
            select(ModelAnswer).where(ModelAnswer.parsons_id == task.id)
        )
        saved_model_answer = result.scalar_one()
        assert saved_model_answer.answer_code == "def standalone_ma(x):\n    return x + 10"

    async def test_updates_is_public(self, client, task, test_teacher, db_session):
        # Starts public (task fixture defaults to public)
        assert task.is_public is True

        payload = _problem_payload(
            taskTitle="Update to Private",
            solutionCode="def some_func(x):\n    return x",
            tests="assert some_func(1) == 1",
            is_public=False
        )
        r = await client.put(
            f"/api/problems/{task.id}",
            headers=_auth(test_teacher.username),
            json=payload,
        )
        assert r.status_code == 200
        await db_session.refresh(task)
        assert task.is_public is False

        # Update back to public
        payload["is_public"] = True
        r = await client.put(
            f"/api/problems/{task.id}",
            headers=_auth(test_teacher.username),
            json=payload,
        )
        assert r.status_code == 200
        await db_session.refresh(task)
        assert task.is_public is True


# ---------------------------------------------------------------------------
# GET /api/problems/{task_id}/editable
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestCheckTaskEditable:
    async def test_fresh_task_is_editable(self, client, task, test_teacher):
        r = await client.get(
            f"/api/problems/{task.id}/editable",
            headers=_auth(test_teacher.username),
        )
        assert r.status_code == 200
        assert r.json()["editable"] is True

    async def test_not_editable_when_students_enrolled_in_set(
        self, client, task_set_with_task, student_session, test_teacher
    ):
        _, task = task_set_with_task
        r = await client.get(
            f"/api/problems/{task.id}/editable",
            headers=_auth(test_teacher.username),
        )
        assert r.status_code == 200
        assert r.json()["editable"] is False

    async def test_not_editable_when_in_other_teachers_set(
        self, client, task_in_other_teachers_set, test_teacher
    ):
        task, _ = task_in_other_teachers_set
        r = await client.get(
            f"/api/problems/{task.id}/editable",
            headers=_auth(test_teacher.username),
        )
        assert r.status_code == 200
        assert r.json()["editable"] is False

    async def test_unauthorized(self, client, task):
        r = await client.get(f"/api/problems/{task.id}/editable")
        assert r.status_code == 401

    async def test_not_found(self, client, test_teacher):
        r = await client.get(
            "/api/problems/99999/editable",
            headers=_auth(test_teacher.username),
        )
        assert r.status_code == 404

    async def test_not_owner_gets_403(self, client, task, other_teacher):
        r = await client.get(
            f"/api/problems/{task.id}/editable",
            headers=_auth(other_teacher.username),
        )
        assert r.status_code == 403


# ---------------------------------------------------------------------------
# DELETE /api/my_sets/{task_set_id}
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestDeleteTaskSet:
    async def test_success(self, client, task_set, test_teacher, db_session):
        r = await client.delete(
            f"/api/my_sets/{task_set.id}",
            headers=_auth(test_teacher.username),
        )
        assert r.status_code == 204
        result = await db_session.execute(select(TaskSet).where(TaskSet.id == task_set.id))
        assert result.scalar_one_or_none() is None

    async def test_not_found(self, client, test_teacher):
        r = await client.delete("/api/my_sets/99999", headers=_auth(test_teacher.username))
        assert r.status_code == 404

    async def test_unauthorized(self, client, task_set):
        r = await client.delete(f"/api/my_sets/{task_set.id}")
        assert r.status_code == 401

    async def test_not_owner_gets_403(self, client, task_set, other_teacher):
        r = await client.delete(
            f"/api/my_sets/{task_set.id}",
            headers=_auth(other_teacher.username),
        )
        assert r.status_code == 403

    async def test_blocked_when_students_enrolled(
        self, client, task_set, student_session, test_teacher
    ):
        r = await client.delete(
            f"/api/my_sets/{task_set.id}",
            headers=_auth(test_teacher.username),
        )
        assert r.status_code == 409

    async def test_task_not_deleted_when_set_is_deleted(
        self, client, task_set_with_task, test_teacher, db_session
    ):
        task_set, task = task_set_with_task
        r = await client.delete(
            f"/api/my_sets/{task_set.id}",
            headers=_auth(test_teacher.username),
        )
        assert r.status_code == 204
        task_result = await db_session.execute(select(Parsons).where(Parsons.id == task.id))
        assert task_result.scalar_one_or_none() is not None

    async def test_admin_cannot_delete_others_task_set(
        self, client, task_set, admin_teacher
    ):
        r = await client.delete(
            f"/api/my_sets/{task_set.id}",
            headers=_auth(admin_teacher.username),
        )
        assert r.status_code == 403


# ---------------------------------------------------------------------------
# DELETE /api/my_sets/{task_set_id}/students/{student.id}
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestRemoveStudentFromTaskSet:
    async def test_success_removes_only_this_task_set_data(
        self, client, db_session, test_teacher, task_set, task
    ):
        other_set = TaskSet(
            teacher_id=test_teacher.id,
            title="Week 2 Exercises",
            unique_link_code="WEEK2",
        )
        db_session.add(other_set)
        await db_session.flush()

        db_session.add_all([
            TaskSetItem(task_set_id=task_set.id, task_id=task.id),
            TaskSetItem(task_set_id=other_set.id, task_id=task.id),
        ])

        student = Student(username="student_remove", email="student_remove@example.com")
        student.set_password("studentpass123")
        db_session.add(student)
        await db_session.flush()

        db_session.add_all([
            StudentTaskSetEnrollment(student_id=student.id, task_set_id=task_set.id),
            StudentTaskSetEnrollment(student_id=student.id, task_set_id=other_set.id),
        ])
        await db_session.flush()

        enrollment_target = StudentTaskEnrollment(
            student_id=student.id,
            task_id=task.id,
            task_set_id=task_set.id,
        )
        enrollment_other = StudentTaskEnrollment(
            student_id=student.id,
            task_id=task.id,
            task_set_id=other_set.id,
        )
        db_session.add_all([enrollment_target, enrollment_other])
        await db_session.flush()

        session_target = TaskSession(student_task_enrollment_id=enrollment_target.id)
        session_other = TaskSession(student_task_enrollment_id=enrollment_other.id)
        db_session.add_all([session_target, session_other])
        await db_session.flush()

        attempt_target = TaskAttempt(
            student_id=student.id,
            task_id=task.id,
            student_task_enrollment_id=enrollment_target.id,
            task_session_id=session_target.id,
            success=False,
        )
        attempt_other = TaskAttempt(
            student_id=student.id,
            task_id=task.id,
            student_task_enrollment_id=enrollment_other.id,
            task_session_id=session_other.id,
            success=True,
        )
        db_session.add_all([attempt_target, attempt_other])
        await db_session.flush()

        db_session.add_all([
            MoveEvent(
                attempt_id=attempt_target.id,
                block_id="b1",
                from_container="source",
                to_container="solution",
                from_index=0,
                to_index=0,
                from_indent=0,
                to_indent=0,
            ),
            MoveEvent(
                attempt_id=attempt_other.id,
                block_id="b2",
                from_container="source",
                to_container="solution",
                from_index=0,
                to_index=0,
                from_indent=0,
                to_indent=0,
            ),
            EditEvent(attempt_id=attempt_target.id, block_id="b1", blank_index=0, value="x"),
            EditEvent(attempt_id=attempt_other.id, block_id="b2", blank_index=0, value="y"),
        ])
        await db_session.commit()

        response = await client.delete(
            f"/api/my_sets/{task_set.id}/students/{student.id}",
            headers=_auth(test_teacher.username),
        )
        assert response.status_code == 204

        student_in_db = (
            await db_session.execute(select(Student).where(Student.id == student.id))
        ).scalar_one_or_none()
        assert student_in_db is not None

        removed_set_enrollment = (
            await db_session.execute(
                select(StudentTaskSetEnrollment).where(
                    StudentTaskSetEnrollment.student_id == student.id,
                    StudentTaskSetEnrollment.task_set_id == task_set.id,
                )
            )
        ).scalar_one_or_none()
        assert removed_set_enrollment is None

        kept_set_enrollment = (
            await db_session.execute(
                select(StudentTaskSetEnrollment).where(
                    StudentTaskSetEnrollment.student_id == student.id,
                    StudentTaskSetEnrollment.task_set_id == other_set.id,
                )
            )
        ).scalar_one_or_none()
        assert kept_set_enrollment is not None

        removed_task_enrollment = (
            await db_session.execute(
                select(StudentTaskEnrollment).where(StudentTaskEnrollment.id == enrollment_target.id)
            )
        ).scalar_one_or_none()
        assert removed_task_enrollment is None

        kept_task_enrollment = (
            await db_session.execute(
                select(StudentTaskEnrollment).where(StudentTaskEnrollment.id == enrollment_other.id)
            )
        ).scalar_one_or_none()
        assert kept_task_enrollment is not None

        removed_attempt = (
            await db_session.execute(select(TaskAttempt).where(TaskAttempt.id == attempt_target.id))
        ).scalar_one_or_none()
        assert removed_attempt is None

        kept_attempt = (
            await db_session.execute(select(TaskAttempt).where(TaskAttempt.id == attempt_other.id))
        ).scalar_one_or_none()
        assert kept_attempt is not None

    async def test_not_owner_gets_403(self, client, task_set, other_teacher):
        response = await client.delete(
            f"/api/my_sets/{task_set.id}/students/1",
            headers=_auth(other_teacher.username),
        )
        assert response.status_code == 403


class TestUpdateAndReorderTaskSetTasks:
    async def test_update_task_set_tasks_success(self, client, task_set, test_teacher, task, db_session):
        prob2 = Parsons(
            title="Second Problem",
            task_instructions="Instructions",
            task_type="algorithms",
            code_blocks={"blocks": []},
            correct_solution={"blocks": []},
            created_by_teacher_id=test_teacher.id,
        )
        db_session.add(prob2)
        await db_session.commit()
        await db_session.refresh(prob2)

        # Reorder/update tasks: [prob2.id, task.id]
        response = await client.put(
            f"/api/my_sets/{task_set.id}/tasks",
            headers=_auth(test_teacher.username),
            json={"task_ids": [prob2.id, task.id]},
        )
        assert response.status_code == 200
        assert response.json()["status"] == "success"

        # Verify new order via GET tasks
        get_res = await client.get(f"/api/my_sets/{task_set.unique_link_code}/tasks")
        assert get_res.status_code == 200
        tasks = get_res.json()
        assert len(tasks) == 2
        assert tasks[0]["id"] == prob2.id
        assert tasks[1]["id"] == task.id

    async def test_update_task_set_tasks_unauthorized(self, client, task_set, other_teacher, task):
        response = await client.put(
            f"/api/my_sets/{task_set.id}/tasks",
            headers=_auth(other_teacher.username),
            json={"task_ids": [task.id]},
        )
        assert response.status_code == 403

    async def test_add_tasks_to_task_set_success(self, client, task_set, test_teacher, db_session):
        prob2 = Parsons(
            title="Another Problem",
            task_instructions="Instructions",
            task_type="algorithms",
            code_blocks={"blocks": []},
            correct_solution={"blocks": []},
            created_by_teacher_id=test_teacher.id,
        )
        db_session.add(prob2)
        await db_session.commit()
        await db_session.refresh(prob2)

        response = await client.post(
            f"/api/my_sets/{task_set.id}/tasks",
            headers=_auth(test_teacher.username),
            json={"task_ids": [prob2.id]},
        )
        assert response.status_code == 201
        assert response.json()["status"] == "success"
        assert response.json()["added_count"] == 1

    async def test_create_stdout_problem_with_function_calls(self, client, test_teacher):
        payload = _problem_payload(
            taskTitle="Stdout Function Task",
            solutionCode="def hello(target):\n    print('Hello', target)",
            tests="hello('Emily')\nhello('Bob')",
            eval_type="stdout",
            expected_output="Hello Emily\nHello Bob",
        )
        r = await client.post(
            "/api/problems",
            headers=_auth(test_teacher.username),
            json=payload,
        )
        assert r.status_code == 200
        task_id = r.json()["id"]

        get_res = await client.get(f"/api/tasks/{task_id}", headers=_auth(test_teacher.username))
        assert get_res.status_code == 200
        data = get_res.json()
        assert data["correct_solution"]["eval_type"] == "stdout"
        assert data["correct_solution"]["teacher_tests"] == "hello('Emily')\nhello('Bob')"
        assert data["correct_solution"]["expected_output"] == "Hello Emily\nHello Bob"




