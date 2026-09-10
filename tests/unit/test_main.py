"""
Unit tests for backend/main.py.

Uses shared fixtures from conftest.py:
  - test_teacher / inactive_teacher  (Teacher rows)
  - task                             (a public Parsons problem)
  - private_task                     (a non-public Parsons problem)
  - task_set                       (TaskSet with unique_link_code "WEEK1")
  - task_set_with_task             (task_set + task linked via TaskSetItem)
  - student_session                  (StudentSession for task_set)

SQLite stores datetimes as naive, so all datetime fixtures are naive too.
"""

import os
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from backend.teacher_auth import create_access_token
import backend.main as main_module
import utils as utils
import backend.config as config
import backend.reset_db as reset_module
import backend.seed as seed_module
from backend.models import Parsons, Student, StudentTaskSetEnrollment, Teacher, TaskAttempt, TaskSet, StudentTaskEnrollment, TaskSession, TaskSetItem, TaskSetViewer, RegistrationToken
from backend.utils import hash_token


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _auth(username: str) -> dict:
    """Return an Authorization header dict for the given teacher username."""
    return {"Authorization": f"Bearer {create_access_token({'sub': username})}"}


def _submit(task_id: int, *, success=True, code="print(1)",
            start_time="2026-01-01T10:00:00", moves=None) -> dict:
    """Build a submit-result JSON body."""
    payload = {
        "task_id": task_id,
        "success": success,
        "submitted_code": code,
        "test_output": "ok" if success else "fail",
        "repr_code": code,
        "moves": moves or [],
    }
    if start_time is not None:
        payload["start_time"] = start_time
    return payload


async def _add_attempt(db_session, ss_id: int, task_id: int, task_set_id: int, *,
                        success: bool, code="x",
                        start_time=None, end=None) -> TaskAttempt:
    start = start_time or datetime(2026, 1, 1, 0, 0, 0)
    end = end or datetime(2026, 1, 1, 0, 1, 0)

    result = await db_session.execute(
        select(StudentTaskEnrollment).where(
            StudentTaskEnrollment.student_id == ss_id,
            StudentTaskEnrollment.task_id == task_id,
            StudentTaskEnrollment.task_set_id == task_set_id,
        )
    )
    enrollment = result.scalar_one_or_none()
    if not enrollment:
        enrollment = StudentTaskEnrollment(
            student_id=ss_id, task_id=task_id,
            task_set_id=task_set_id, started_at=start
        )
        db_session.add(enrollment)
        await db_session.commit()
        await db_session.refresh(enrollment)

    session = TaskSession(
        student_task_enrollment_id=enrollment.id,
        entered_at=start,
        exited_at=end,
    )
    db_session.add(session)
    await db_session.flush()

    a = TaskAttempt(
        student_id=ss_id,
        task_id=task_id,
        student_task_enrollment_id=enrollment.id,
        task_session_id=session.id,
        completed_at=end,
        success=success,
        submitted_inputs={"code": code},
    )
    db_session.add(a)
    await db_session.commit()
    await db_session.refresh(a)
    return a


async def _create_shared_viewer(db_session, task_set_id: int) -> Teacher:
    viewer = Teacher(
        username="sharedviewer",
        email="sharedviewer@example.com",
        is_active=True,
    )
    viewer.set_password("testpassword123")
    db_session.add(viewer)
    await db_session.commit()
    await db_session.refresh(viewer)

    db_session.add(TaskSetViewer(task_set_id=task_set_id, teacher_id=viewer.id))
    await db_session.commit()
    return viewer


# ---------------------------------------------------------------------------
# /test/reset-db
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestResetDb:
    async def test_forbidden_when_test_mode_is_false(self, client):
        original = config.TEST_MODE
        try:
            config.TEST_MODE = False
            r = await client.post("/test/reset-db")
            assert r.status_code == 403
        finally:
            config.TEST_MODE = original


# ---------------------------------------------------------------------------
# Static HTML pages
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestStaticPages:
    async def test_index_returns_200(self, client):
        assert (await client.get("/")).status_code == 200

    async def test_index_html_returns_200(self, client):
        assert (await client.get("/")).status_code == 200

    async def test_teacher_register_page_returns_200(self, client):
        assert (await client.get("/teacher-register")).status_code == 200

    async def test_student_start_task_unauthenticated_redirects(self, client):
        r = await client.get("/student-start-task", follow_redirects=False)
        assert r.status_code == 303
        assert "/" in r.headers["location"]
    async def test_global_statistics_unauthenticated_redirects(self, client):
        r = await client.get("/global-statistics", follow_redirects=False)
        assert r.status_code == 303
        assert "/" in r.headers["location"]

    async def test_global_statistics_authenticated_returns_200(self, client, test_teacher):
        r = await client.get("/global-statistics", headers=_auth(test_teacher.username))
        assert r.status_code == 200

    async def test_task_preview_unauthenticated_redirects(self, client):
        r = await client.get("/task", follow_redirects=False)
        assert r.status_code == 303
        assert "/" in r.headers["location"]

    async def test_task_preview_authenticated_returns_200(self, client, test_teacher):
        r = await client.get("/task", headers=_auth(test_teacher.username))
        assert r.status_code == 200

    async def test_task_statistics_view_unauthenticated_redirects(self, client):
        r = await client.get("/task-statistics", follow_redirects=False)
        assert r.status_code == 303
        assert "/" in r.headers["location"]

    async def test_task_statistics_view_authenticated_returns_200(self, client, test_teacher):
        r = await client.get("/task-statistics", headers=_auth(test_teacher.username))
        assert r.status_code == 200

    async def test_task_statistics_view_shared_viewer_can_open_private_task_in_shared_set(
        self, client, db_session, task_set, private_task
    ):
        db_session.add(TaskSetItem(task_set_id=task_set.id, task_id=private_task.id))
        await db_session.commit()
        viewer = await _create_shared_viewer(db_session, task_set.id)

        r = await client.get(
            f"/task-statistics?id={private_task.id}&task_set={task_set.unique_link_code}&set_id={task_set.id}",
            headers=_auth(viewer.username),
        )
        assert r.status_code == 200


# ---------------------------------------------------------------------------
# /{username}/set/{unique_link_code}  and sub-pages
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestProblemsetPages:
    async def test_unknown_code_returns_404(self, client, test_teacher):
        assert (await client.get(f"/{test_teacher.username}/set/NOCODE")).status_code == 404

    async def test_no_session_serves_nickname_page(self, client, task_set, test_teacher):
        r = await client.get(f"/{test_teacher.username}/set/{task_set.unique_link_code}", follow_redirects=False)
        assert r.status_code == 200

    async def test_active_session_redirects_to_tasks(self, client, task_set, test_teacher, student_session):
        client.cookies.set("student_session", student_session.session_token)
        r = await client.get(f"/{test_teacher.username}/set/{task_set.unique_link_code}", follow_redirects=False)
        client.cookies.clear()
        assert r.status_code == 303
        assert "/tasks" in r.headers["location"]

    async def test_tasks_page_unknown_code_returns_404(self, client, test_teacher):
        assert (await client.get(f"/{test_teacher.username}/set/NOCODE/tasks")).status_code == 404

    async def test_tasks_page_redirects_without_session(self, client, task_set, test_teacher):
        r = await client.get(f"/{test_teacher.username}/set/{task_set.unique_link_code}/tasks", follow_redirects=False)
        assert r.status_code == 303
        assert r.headers["location"] == f"/{test_teacher.username}/set/{task_set.unique_link_code}"

    async def test_tasks_page_returns_200_with_session(self, client, task_set, test_teacher, student_session):
        client.cookies.set("student_session", student_session.session_token)
        r = await client.get(f"/{test_teacher.username}/set/{task_set.unique_link_code}/tasks", follow_redirects=False)
        client.cookies.clear()
        assert r.status_code == 200

    async def test_task_page_unknown_code_returns_404(self, client, test_teacher):
        assert (await client.get(f"/{test_teacher.username}/set/NOCODE/tasks/1")).status_code == 404

    async def test_task_page_redirects_without_session(self, client, task_set_with_task, test_teacher):
        task_set, _ = task_set_with_task
        r = await client.get(
            f"/{test_teacher.username}/set/{task_set.unique_link_code}/tasks/1",
            follow_redirects=False,
        )
        assert r.status_code == 303
        assert r.headers["location"] == f"/{test_teacher.username}/set/{task_set.unique_link_code}"

    async def test_task_page_returns_200_with_session(self, client, task_set_with_task, test_teacher, student_session):
        task_set, _ = task_set_with_task
        client.cookies.set("student_session", student_session.session_token)
        r = await client.get(
            f"/{test_teacher.username}/set/{task_set.unique_link_code}/tasks/1",
            follow_redirects=False,
        )
        client.cookies.clear()
        assert r.status_code == 200

    async def test_task_page_out_of_range_returns_404(self, client, task_set_with_task, test_teacher, student_session):
        task_set, _ = task_set_with_task
        client.cookies.set("student_session", student_session.session_token)
        r = await client.get(
            f"/{test_teacher.username}/set/{task_set.unique_link_code}/tasks/2",
            follow_redirects=False,
        )
        client.cookies.clear()
        assert r.status_code == 404

    async def test_start_page_unknown_code_returns_404(self, client, test_teacher):
        assert (await client.get(f"/{test_teacher.username}/set/NOCODE/tasks/1/start")).status_code == 404

    async def test_start_page_redirects_without_session(self, client, task_set_with_task, test_teacher):
        task_set, _ = task_set_with_task
        r = await client.get(
            f"/{test_teacher.username}/set/{task_set.unique_link_code}/tasks/1/start",
            follow_redirects=False,
        )
        assert r.status_code == 303
        assert r.headers["location"] == f"/{test_teacher.username}/set/{task_set.unique_link_code}"

    async def test_start_page_returns_200_with_session(self, client, task_set_with_task, test_teacher, student_session):
        task_set, _ = task_set_with_task
        client.cookies.set("student_session", student_session.session_token)
        r = await client.get(
            f"/{test_teacher.username}/set/{task_set.unique_link_code}/tasks/1/start",
            follow_redirects=False,
        )
        client.cookies.clear()
        assert r.status_code == 200


# ---------------------------------------------------------------------------
# POST /api/login/access-token
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestLogin:
    async def test_valid_credentials_return_token(self, client, test_teacher):
        r = await client.post(
            "/api/login/access-token",
            data={"username": "test@example.com", "password": "testpassword123"},
        )
        assert r.status_code == 200
        assert "access_token" in r.json()
        assert r.json()["token_type"] == "bearer"

    async def test_valid_login_sets_cookie(self, client, test_teacher):
        r = await client.post(
            "/api/login/access-token",
            data={"username": "test@example.com", "password": "testpassword123"},
        )
        assert "access_token" in r.cookies

    async def test_valid_email_login_returns_token(self, client, test_teacher):
        r = await client.post(
            "/api/login/access-token",
            data={"username": "test@example.com", "password": "testpassword123"},
        )
        assert r.status_code == 200
        assert "access_token" in r.json()

    async def test_wrong_password_returns_400(self, client, test_teacher):
        r = await client.post(
            "/api/login/access-token",
            data={"username": "test@example.com", "password": "wrong"},
        )
        assert r.status_code == 400
        assert "Incorrect" in r.json()["detail"]

    async def test_nonexistent_user_returns_400(self, client):
        r = await client.post(
            "/api/login/access-token",
            data={"username": "ghost", "password": "pass"},
        )
        assert r.status_code == 400

    async def test_inactive_user_returns_400(self, client, inactive_teacher):
        # authenticate_user() returns None for inactive users, so the response
        # is "Incorrect username or password" rather than "Inactive user".
        r = await client.post(
            "/api/login/access-token",
            data={"username": "inactiveteacher", "password": "testpassword123"},
        )
        assert r.status_code == 400


# ---------------------------------------------------------------------------
# GET /api/me
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestGetMe:
    async def test_authenticated_returns_user_info(self, client, test_teacher):
        r = await client.get("/api/me", headers=_auth(test_teacher.username))
        assert r.status_code == 200
        assert r.json() == {
            "id": test_teacher.id,
            "username": "testteacher",
            "email": "test@example.com",
            "is_admin_teacher": False,
            "role": "Teacher",
        }

    async def test_unauthenticated_returns_401(self, client):
        assert (await client.get("/api/me")).status_code == 401


# ---------------------------------------------------------------------------
# POST /api/logout
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestLogout:
    async def test_returns_success_message(self, client):
        r = await client.post("/api/logout")
        assert r.status_code == 200
        assert "logged out" in r.json()["message"].lower()


# ---------------------------------------------------------------------------
# POST /api/register
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestRegister:
    async def test_valid_registration_succeeds(self, client, valid_registration_payload):
        r = await client.post("/api/teacher_register", json=valid_registration_payload)
        assert r.status_code == 200
        assert r.json()["status"] == "success"

    async def test_invalid_json_returns_400(self, client):
        r = await client.post(
            "/api/teacher_register",
            content=b"not-json",
            headers={"Content-Type": "application/json"},
        )
        assert r.status_code == 400

    async def test_empty_username_returns_400(self, client, valid_registration_payload):
        r = await client.post("/api/teacher_register", json={**valid_registration_payload, "username": ""})
        assert r.status_code == 400
        assert "required" in r.json()["detail"]

    async def test_empty_password_returns_400(self, client, valid_registration_payload):
        r = await client.post("/api/teacher_register",
                               json={**valid_registration_payload, "password": "", "password_confirm": ""})
        assert r.status_code == 400

    async def test_empty_email_returns_400(self, client, valid_registration_payload):
        r = await client.post("/api/teacher_register", json={**valid_registration_payload, "email": ""})
        assert r.status_code == 400

    async def test_password_mismatch_returns_400(self, client, valid_registration_payload):
        r = await client.post("/api/teacher_register",
                               json={**valid_registration_payload, "password_confirm": "different"})
        assert r.status_code == 400
        assert "Passwords do not match" in r.json()["detail"]

    async def test_username_too_long_returns_400(self, client, valid_registration_payload):
        r = await client.post("/api/teacher_register", json={**valid_registration_payload, "username": "a" * 51})
        assert r.status_code == 400
        assert "too long" in r.json()["detail"]

    async def test_email_too_long_returns_400(self, client, valid_registration_payload):
        r = await client.post("/api/teacher_register",
                               json={**valid_registration_payload, "email": "a" * 101 + "@x.com"})
        assert r.status_code == 400
        assert "too long" in r.json()["detail"]

    async def test_username_too_short_returns_400(self, client, valid_registration_payload):
        r = await client.post("/api/teacher_register", json={**valid_registration_payload, "username": "ab"})
        assert r.status_code == 400
        assert "minimum length" in r.json()["detail"]

    async def test_password_too_short_returns_400(self, client, valid_registration_payload):
        r = await client.post("/api/teacher_register",
                               json={**valid_registration_payload, "password": "short", "password_confirm": "short"})
        assert r.status_code == 400
        assert "minimum length" in r.json()["detail"]

    async def test_duplicate_username_returns_400(self, client, test_teacher, valid_registration_payload):
        payload = {**valid_registration_payload, "username": "testteacher", "email": "other@example.com"}
        r = await client.post("/api/teacher_register", json=payload)
        assert r.status_code == 400
        assert "already exists" in r.json()["detail"]

    async def test_duplicate_email_returns_400(self, client, test_teacher, valid_registration_payload):
        payload = {**valid_registration_payload, "username": "uniqueuser9", "email": "test@example.com"}
        r = await client.post("/api/teacher_register", json=payload)
        assert r.status_code == 400
        assert "already exists" in r.json()["detail"]

    async def test_whitespace_username_treated_as_empty(self, client, valid_registration_payload):
        r = await client.post("/api/teacher_register", json={**valid_registration_payload, "username": "   "})
        assert r.status_code == 400

    async def test_whitespace_email_treated_as_empty(self, client, valid_registration_payload):
        r = await client.post("/api/teacher_register", json={**valid_registration_payload, "email": "   "})
        assert r.status_code == 400

    async def test_missing_token_returns_403(self, client, valid_registration_payload):
        payload = {k: v for k, v in valid_registration_payload.items() if k != "registration_token"}
        r = await client.post("/api/teacher_register", json=payload)
        assert r.status_code == 403
        assert "Registration token is required" in r.json()["detail"]

    async def test_wrong_token_returns_403(self, client, valid_registration_payload):
        r = await client.post("/api/teacher_register",
                               json={**valid_registration_payload, "registration_token": "wrong_token"})
        assert r.status_code == 403
        assert "Invalid registration token" in r.json()["detail"]

    async def test_old_token_is_deleted_after_two_months(
        self,
        client,
        db_session,
        test_teacher,
        valid_registration_payload,
    ):
        stale_token = RegistrationToken(
            token_hash=hash_token("stale-registration-token"),
            created_by_admin_id=test_teacher.id,
            expires_at=datetime.now(timezone.utc) + timedelta(days=7),
        )
        stale_token.created_at = datetime.now(timezone.utc) - timedelta(days=61)
        db_session.add(stale_token)
        await db_session.commit()

        r = await client.post("/api/teacher_register", json=valid_registration_payload)
        assert r.status_code == 200

        stale_after = await db_session.get(RegistrationToken, stale_token.id)
        assert stale_after is None

    async def test_empty_token_returns_403(self, client, valid_registration_payload):
        r = await client.post("/api/teacher_register",
                               json={**valid_registration_payload, "registration_token": ""})
        assert r.status_code == 403
        assert "Registration token is required" in r.json()["detail"]

# ---------------------------------------------------------------------------
# GET /api/tasks/{task_id}
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestGetTask:
    async def test_returns_task_data(self, client, task):
        r = await client.get(f"/api/tasks/{task.id}")
        assert r.status_code == 200
        body = r.json()
        assert body["id"] == task.id
        assert body["title"] == "Hello World"
        assert body["task_instructions"] == "Arrange the blocks to print 'Hello, World!'"
        assert body["task_type"] == "python"
        assert body["model_answer"] is None

    async def test_returns_model_answer_when_authenticated_teacher(self, client, db_session, test_teacher, task):
        from backend.models import ModelAnswer
        ma = ModelAnswer(
            parsons_id=task.id,
            created_by_teacher_id=test_teacher.id,
            answer_code="print('Hello, World!')"
        )
        db_session.add(ma)
        await db_session.commit()

        # Anonymous gets None
        r = await client.get(f"/api/tasks/{task.id}")
        assert r.status_code == 200
        assert r.json()["model_answer"] is None

        # Authenticated teacher gets the model answer
        r2 = await client.get(f"/api/tasks/{task.id}", headers=_auth(test_teacher.username))
        assert r2.status_code == 200
        assert r2.json()["model_answer"] == "print('Hello, World!')"


    async def test_task_without_description_returns_null(self, client, db_session, test_teacher):
        t = Parsons(
            created_by_teacher_id=test_teacher.id, title="NoInstr", task_type="python",
            task_instructions='{}', code_blocks={}, correct_solution={}, is_public=True,
        )
        db_session.add(t)
        await db_session.commit()
        await db_session.refresh(t)
        r = await client.get(f"/api/tasks/{t.id}")
        assert r.status_code == 200
        assert r.json()["description"] is None

    async def test_nonexistent_task_returns_404(self, client):
        assert (await client.get("/api/tasks/99999")).status_code == 404


# ---------------------------------------------------------------------------
# GET /api/tasks  — list visible tasks for current teacher
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestListTasks:
    async def test_includes_public_and_own_private(self, client, task, private_task, test_teacher):
        r = await client.get("/api/tasks", headers=_auth(test_teacher.username))
        assert r.status_code == 200
        ids = [t["id"] for t in r.json()]
        assert task.id in ids
        assert private_task.id in ids

    async def test_excludes_private_from_other_teacher(self, client, db_session, test_teacher):
        other_teacher = Teacher(
            username="otherteacher",
            email="other@example.com",
            is_active=True,
        )
        other_teacher.set_password("testpassword123")
        db_session.add(other_teacher)
        await db_session.commit()
        await db_session.refresh(other_teacher)

        other_private = Parsons(
            created_by_teacher_id=other_teacher.id,
            title="Other Private Task",
            task_instructions='{"task_instructions": "Internal only."}',
            description='{"description": "Not visible to others."}',
            task_type="python",
            code_blocks={"blocks": []},
            correct_solution={"solution": [], "require_indentation": True},
            is_public=False,
        )
        db_session.add(other_private)
        await db_session.commit()
        await db_session.refresh(other_private)

        r = await client.get("/api/tasks", headers=_auth(test_teacher.username))
        assert r.status_code == 200
        ids = [t["id"] for t in r.json()]
        assert other_private.id not in ids

    async def test_parses_json_description_field(self, client, task, test_teacher):
        r = await client.get("/api/tasks", headers=_auth(test_teacher.username))
        found = next(t for t in r.json() if t["id"] == task.id)
        assert found["description"] == "Print hello world."

    async def test_invalid_json_instructions_returns_empty_string(self, client, db_session, test_teacher):
        t = Parsons(
            created_by_teacher_id=test_teacher.id, title="BadJson", task_type="python",
            task_instructions="not-json", description='{}', code_blocks={}, correct_solution={}, is_public=True,
        )
        db_session.add(t)
        await db_session.commit()
        r = await client.get("/api/tasks", headers=_auth(test_teacher.username))
        found = next(t for t in r.json() if t["title"] == "BadJson")
        assert found["task_instructions"] == ""

    async def test_empty_instructions_string_returns_empty(self, client, db_session, test_teacher):
        t = Parsons(
            created_by_teacher_id=test_teacher.id, title="EmptyStr", task_type="python",
            task_instructions="", description='{}', code_blocks={}, correct_solution={}, is_public=True,
        )
        db_session.add(t)
        await db_session.commit()
        r = await client.get("/api/tasks", headers=_auth(test_teacher.username))
        found = next(t for t in r.json() if t["title"] == "EmptyStr")
        assert found["task_instructions"] == ""


# ---------------------------------------------------------------------------
# GET /api/my_sets/{id}
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestGetProblemset:
    async def test_returns_task_set_data(self, client, task_set, test_teacher):
        r = await client.get(
            f"/api/my_sets/{task_set.id}",
            headers=_auth(test_teacher.username),
        )
        assert r.status_code == 200
        body = r.json()
        assert body["id"] == task_set.id
        assert body["unique_link_code"] == "WEEK1"
        assert body["expires_at"] is None

    async def test_task_set_with_expires_at(self, client, db_session, test_teacher):
        from datetime import timezone
        ps = TaskSet(
            teacher_id=test_teacher.id, title="Expiring", unique_link_code="EXP01",
            expires_at=datetime(2027, 1, 1, tzinfo=timezone.utc),
        )
        db_session.add(ps)
        await db_session.commit()
        await db_session.refresh(ps)
        r = await client.get(
            f"/api/my_sets/{ps.id}",
            headers=_auth(test_teacher.username),
        )
        assert r.status_code == 200
        assert r.json()["expires_at"] is not None

    async def test_nonexistent_returns_404(self, client, test_teacher):
        assert (await client.get("/api/my_sets/99999", headers=_auth(test_teacher.username))).status_code == 404


# ---------------------------------------------------------------------------
# GET /api/my_sets/{code}/tasks
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestGetProblemsetTasks:
    async def test_get_by_string_code(self, client, task_set_with_task):
        ps, task = task_set_with_task
        r = await client.get(f"/api/my_sets/{ps.unique_link_code}/tasks")
        assert r.status_code == 200
        assert len(r.json()) == 1
        assert r.json()[0]["id"] == task.id

    async def test_integer_id_returns_404(self, client, task_set_with_task):
        ps, _ = task_set_with_task
        r = await client.get(f"/api/my_sets/{ps.id}/tasks")
        assert r.status_code == 404

    async def test_numeric_unique_link_code_is_resolved_as_code(self, client, db_session, test_teacher, task):
        ps = TaskSet(
            teacher_id=test_teacher.id,
            title="Numeric Code List",
            unique_link_code="303",
        )
        db_session.add(ps)
        await db_session.commit()
        await db_session.refresh(ps)

        db_session.add(TaskSetItem(task_set_id=ps.id, task_id=task.id))
        await db_session.commit()

        r = await client.get("/api/my_sets/303/tasks")
        assert r.status_code == 200
        assert len(r.json()) == 1
        assert r.json()[0]["id"] == task.id

    async def test_unknown_code_returns_404(self, client):
        assert (await client.get("/api/my_sets/NOSUCHCODE/tasks")).status_code == 404

    async def test_unknown_id_returns_404(self, client):
        assert (await client.get("/api/my_sets/99999/tasks")).status_code == 404

    async def test_empty_task_set_returns_empty_list(self, client, task_set):
        r = await client.get(f"/api/my_sets/{task_set.unique_link_code}/tasks")
        assert r.status_code == 200
        assert r.json() == []

    async def test_task_set_tasks_report_faded_status_from_blocks(self, client, db_session, test_teacher, task_set):
        task = Parsons(
            created_by_teacher_id=test_teacher.id,
            title="Faded Blocks Task",
            description='{"description": "Has faded blocks."}',
            task_instructions="Arrange the blocks",
            task_type="normal",
            code_blocks={
                "blocks": [
                    {"id": "block_1", "code": "print('hello')", "indent": 0, "faded": False, "given": False},
                    {"id": "block_2", "code": "print(___)", "indent": 0, "faded": True, "given": False},
                ]
            },
            correct_solution={"solution": [], "require_indentation": True},
            is_public=True,
        )
        db_session.add(task)
        await db_session.commit()
        await db_session.refresh(task)

        db_session.add(TaskSetItem(task_set_id=task_set.id, task_id=task.id))
        await db_session.commit()

        r = await client.get(f"/api/my_sets/{task_set.unique_link_code}/tasks")
        assert r.status_code == 200
        assert r.json()[0]["is_faded"] is True

    async def test_task_set_tasks_do_not_report_regular_movable_blocks_as_faded(
        self, client, db_session, test_teacher, task_set
    ):
        task = Parsons(
            created_by_teacher_id=test_teacher.id,
            title="Regular Parsons Task",
            description="Arrange the blocks.",
            task_instructions="Arrange the blocks",
            task_type="normal",
            code_blocks={
                "blocks": [
                    {"id": "block_1", "code": "print('hello')", "indent": 0, "given": False},
                    {"id": "block_2", "code": "print('world')", "indent": 0, "given": False},
                ]
            },
            correct_solution={"solution": [], "require_indentation": False},
            is_public=True,
        )
        db_session.add(task)
        await db_session.commit()
        await db_session.refresh(task)

        db_session.add(TaskSetItem(task_set_id=task_set.id, task_id=task.id))
        await db_session.commit()

        r = await client.get(f"/api/my_sets/{task_set.unique_link_code}/tasks")
        assert r.status_code == 200
        assert r.json()[0]["is_faded"] is False


# ---------------------------------------------------------------------------
# POST /api/tasks/{task_id}/submit-result
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestSubmitResult:
    async def test_no_session_returns_401(self, client, task, task_set_with_task):
        task_set, _ = task_set_with_task
        r = await client.post(f"/api/sets/{task_set.unique_link_code}/tasks/1/submit-result",
                               json=_submit(task.id))
        assert r.status_code == 401

    async def test_success_with_iso_start_time(self, client, task, task_set_with_task, student_session):
        task_set, _ = task_set_with_task
        client.cookies.set("student_session", student_session.session_token)
        r = await client.post(f"/api/sets/{task_set.unique_link_code}/tasks/1/submit-result",
                               json=_submit(task.id, success=True,
                                            start_time="2026-03-01T10:00:00"))
        client.cookies.clear()
        assert r.status_code == 200
        assert r.json()["status"] == "success"

    async def test_success_with_z_suffix_timestamp(self, client, task, task_set_with_task, student_session):
        task_set, _ = task_set_with_task
        client.cookies.set("student_session", student_session.session_token)
        r = await client.post(f"/api/sets/{task_set.unique_link_code}/tasks/1/submit-result",
                               json=_submit(task.id, start_time="2026-03-01T10:00:00Z"))
        client.cookies.clear()
        assert r.status_code == 200

    async def test_invalid_start_time_falls_back_to_now(self, client, task, task_set_with_task, student_session):
        task_set, _ = task_set_with_task
        client.cookies.set("student_session", student_session.session_token)
        r = await client.post(f"/api/sets/{task_set.unique_link_code}/tasks/1/submit-result",
                               json=_submit(task.id, start_time="not-a-date"))
        client.cookies.clear()
        assert r.status_code == 200

    async def test_missing_start_time_uses_now(self, client, task, task_set_with_task, student_session):
        task_set, _ = task_set_with_task
        client.cookies.set("student_session", student_session.session_token)
        r = await client.post(f"/api/sets/{task_set.unique_link_code}/tasks/1/submit-result",
                               json=_submit(task.id))
        client.cookies.clear()
        assert r.status_code == 200

    async def test_attempt_persisted_in_db(self, client, task, task_set_with_task, student_session, db_session):
        task_set, _ = task_set_with_task
        client.cookies.set("student_session", student_session.session_token)
        await client.post(f"/api/sets/{task_set.unique_link_code}/tasks/1/submit-result",
                          json=_submit(task.id, success=True, code="my_answer",
                                       start_time="2026-01-01T00:00:00"))
        client.cookies.clear()
        result = await db_session.execute(
            select(TaskAttempt).where(TaskAttempt.task_id == task.id)
        )
        attempt = result.scalar_one()
        assert attempt.success is True
        assert attempt.submitted_inputs["code"] == "my_answer"
        assert attempt.student_task_enrollment_id is not None

    async def test_failure_attempt_persisted(self, client, task, task_set_with_task, student_session, db_session):
        task_set, _ = task_set_with_task
        client.cookies.set("student_session", student_session.session_token)
        await client.post(f"/api/sets/{task_set.unique_link_code}/tasks/1/submit-result",
                          json=_submit(task.id, success=False, code="wrong",
                                       start_time="2026-01-01T00:00:00"))
        client.cookies.clear()
        result = await db_session.execute(
            select(TaskAttempt).where(TaskAttempt.task_id == task.id)
        )
        attempt = result.scalar_one()
        assert attempt.success is False
        assert attempt.student_task_enrollment_id is not None


# ---------------------------------------------------------------------------
# GET /api/tasks/{task_id}/statistics
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestStatistics:
    async def test_requires_authentication(self, client, task):
        assert (await client.get(f"/api/tasks/{task.id}/statistics")).status_code == 401

    async def test_task_not_found_returns_404(self, client, test_teacher):
        r = await client.get("/api/tasks/99999/statistics",
                              headers=_auth(test_teacher.username))
        assert r.status_code == 404

    async def test_no_attempts_returns_zeros(self, client, task, test_teacher):
        r = await client.get(f"/api/tasks/{task.id}/statistics",
                              headers=_auth(test_teacher.username))
        assert r.status_code == 200
        body = r.json()
        assert body["task_name"] == task.title
        assert body["total_completions"] == 0
        assert body["students_attempted"] == 0
        assert body["students_completed"] == 0
        assert body["avg_tries"] == 0
        assert body["common_mistakes"] == []
        assert body["time_to_first_success"] is None

    async def test_single_success_calculates_time_correctly(
        self, client, task, task_set, student_session, test_teacher, db_session
    ):
        await _add_attempt(db_session, student_session.id, task.id, task_set.id, success=True,
                            start_time=datetime(2026, 1, 1, 0, 0, 0),
                            end=datetime(2026, 1, 1, 0, 2, 0))
        r = await client.get(f"/api/tasks/{task.id}/statistics",
                              headers=_auth(test_teacher.username))
        body = r.json()
        assert body["total_completions"] == 1
        assert body["students_completed"] == 1
        assert body["avg_tries"] == 1
        assert body["time_to_first_success"]["avg"] == 120.0

    async def test_failures_before_success_counted_correctly(
        self, client, task, task_set, student_session, test_teacher, db_session
    ):
        for i in range(2):
            await _add_attempt(db_session, student_session.id, task.id, task_set.id, success=False,
                                code=f"wrong_{i}",
                                start_time=datetime(2026, 1, 1, 0, i, 0),
                                end=datetime(2026, 1, 1, 0, i, 30))
        await _add_attempt(db_session, student_session.id, task.id, task_set.id, success=True,
                            start_time=datetime(2026, 1, 1, 0, 3, 0),
                            end=datetime(2026, 1, 1, 0, 4, 0))
        body = (await client.get(f"/api/tasks/{task.id}/statistics",
                                  headers=_auth(test_teacher.username))).json()
        assert body["total_completions"] == 3
        assert body["students_completed"] == 1
        assert body["avg_tries"] == 3          # success was on attempt #3
        assert body["time_to_first_fail"]["avg"] == 30.0

    async def test_all_failures_no_completions(
        self, client, task, task_set, student_session, test_teacher, db_session
    ):
        for i in range(3):
            await _add_attempt(db_session, student_session.id, task.id, task_set.id, success=False,
                                code="wrong",
                                start_time=datetime(2026, 1, 1, 0, i, 0),
                                end=datetime(2026, 1, 1, 0, i, 30))
        body = (await client.get(f"/api/tasks/{task.id}/statistics",
                                  headers=_auth(test_teacher.username))).json()
        assert body["students_completed"] == 0
        assert body["avg_tries"] == 0
        assert body["time_to_first_success"] is None
        assert body["time_to_first_fail"] is not None

    async def test_multiple_students_aggregated(
        self, client, task, task_set, test_teacher, db_session
    ):
        for i in range(3):
            ss = Student(
                username=f"S{i}",
                email=f"s{i}@example.com",
            )
            ss.set_password("studentpass123")
            db_session.add(ss)
            await db_session.flush()
            db_session.add(StudentTaskSetEnrollment(student_id=ss.id, task_set_id=task_set.id))
            await db_session.commit()
            await db_session.refresh(ss)
            await _add_attempt(db_session, ss.id, task.id, task_set.id, success=True,
                                start_time=datetime(2026, 1, 1, 0, 0, 0),
                                end=datetime(2026, 1, 1, 0, i + 1, 0))
        body = (await client.get(f"/api/tasks/{task.id}/statistics",
                                  headers=_auth(test_teacher.username))).json()
        assert body["students_attempted"] == 3
        assert body["students_completed"] == 3
        assert body["time_to_first_success"]["min"] == 60.0
        assert body["time_to_first_success"]["max"] == 180.0
        assert body["time_to_first_success"]["avg"] == 120.0

    async def test_common_mistakes_sorted_by_frequency(
        self, client, task, task_set, student_session, test_teacher, db_session
    ):
        await _add_attempt(db_session, student_session.id, task.id, task_set.id, success=False, code="bad")
        await _add_attempt(db_session, student_session.id, task.id, task_set.id, success=False, code="bad")
        await _add_attempt(db_session, student_session.id, task.id, task_set.id, success=False, code="worse")
        await _add_attempt(db_session, student_session.id, task.id, task_set.id, success=True, code="good")
        body = (await client.get(f"/api/tasks/{task.id}/statistics",
                                  headers=_auth(test_teacher.username))).json()
        mistakes = body["common_mistakes"]
        assert mistakes[0]["code"] == "bad"
        assert mistakes[0]["count"] == 2

    async def test_common_mistakes_capped_at_five(
        self, client, task, task_set, student_session, test_teacher, db_session
    ):
        for i in range(7):
            await _add_attempt(db_session, student_session.id, task.id, task_set.id,
                                success=False, code=f"mistake_{i}")
        body = (await client.get(f"/api/tasks/{task.id}/statistics",
                                  headers=_auth(test_teacher.username))).json()
        assert len(body["common_mistakes"]) <= 5

    async def test_common_mistakes_group_whitespace_only_variants(
        self, client, task, task_set, student_session, test_teacher, db_session
    ):
        await _add_attempt(db_session, student_session.id, task.id, task_set.id, success=False,
                            code="print(1)")
        await _add_attempt(db_session, student_session.id, task.id, task_set.id, success=False,
                            code="\nprint(1)   \n")
        await _add_attempt(db_session, student_session.id, task.id, task_set.id, success=False,
                            code="print( 1 )")

        body = (await client.get(f"/api/tasks/{task.id}/statistics",
                                  headers=_auth(test_teacher.username))).json()

        mistakes = body["common_mistakes"]
        assert mistakes[0]["count"] == 3
        assert mistakes[0]["code"] in {"print(1)", "print( 1 )"}

    async def test_common_mistakes_keep_string_whitespace_distinct(
        self, client, task, task_set, student_session, test_teacher, db_session
    ):
        await _add_attempt(db_session, student_session.id, task.id, task_set.id, success=False,
                            code='print("a b")')
        await _add_attempt(db_session, student_session.id, task.id, task_set.id, success=False,
                            code='print("ab")')

        body = (await client.get(f"/api/tasks/{task.id}/statistics",
                                  headers=_auth(test_teacher.username))).json()

        mistakes = body["common_mistakes"]
        assert len(mistakes) == 2
        assert {mistake["code"] for mistake in mistakes} == {'print("a b")', 'print("ab")'}

    async def test_attempt_missing_code_key_not_a_mistake(
        self, client, task, task_set, student_session, test_teacher, db_session
    ):
        enrollment = StudentTaskEnrollment(
            student_id=student_session.id,
            task_id=task.id,
            task_set_id=task_set.id,
            started_at=datetime(2026, 1, 1),
        )
        db_session.add(enrollment)
        await db_session.commit()
        await db_session.refresh(enrollment)

        a = TaskAttempt(
            student_id=student_session.id, task_id=task.id,
            student_task_enrollment_id=enrollment.id, completed_at=datetime(2026, 1, 1, 0, 1),
            success=False, submitted_inputs={},   # no "code" key
        )
        db_session.add(a)
        await db_session.commit()
        body = (await client.get(f"/api/tasks/{task.id}/statistics",
                                  headers=_auth(test_teacher.username))).json()
        assert body["common_mistakes"] == []

    async def test_attempt_with_null_submitted_inputs(
        self, client, task, task_set, student_session, test_teacher, db_session
    ):
        enrollment = StudentTaskEnrollment(
            student_id=student_session.id,
            task_id=task.id,
            task_set_id=task_set.id,
            started_at=datetime(2026, 1, 1),
        )
        db_session.add(enrollment)
        await db_session.commit()
        await db_session.refresh(enrollment)

        a = TaskAttempt(
            student_id=student_session.id, task_id=task.id,
            student_task_enrollment_id=enrollment.id, completed_at=datetime(2026, 1, 1, 0, 1),
            success=False, submitted_inputs=None,
        )
        db_session.add(a)
        await db_session.commit()
        body = (await client.get(f"/api/tasks/{task.id}/statistics",
                                  headers=_auth(test_teacher.username))).json()
        assert body["common_mistakes"] == []

    async def test_filter_by_task_set_isolates_students(
        self, client, task, task_set, student_session, test_teacher, db_session
    ):
        # second task_set + student
        ps2 = TaskSet(
            teacher_id=test_teacher.id, title="PS2", unique_link_code="WEEK2"
        )
        db_session.add(ps2)
        await db_session.commit()
        await db_session.refresh(ps2)
        ss2 = Student(username="Other", email="other@example.com")
        ss2.set_password("studentpass123")
        db_session.add(ss2)
        await db_session.flush()
        db_session.add(StudentTaskSetEnrollment(student_id=ss2.id, task_set_id=ps2.id))
        await db_session.commit()
        await db_session.refresh(ss2)

        await _add_attempt(db_session, student_session.id, task.id, task_set.id, success=True)
        await _add_attempt(db_session, ss2.id, task.id, ps2.id, success=True)

        body = (await client.get(
            f"/api/tasks/{task.id}/statistics?task_set_code={task_set.unique_link_code}",
            headers=_auth(test_teacher.username),
        )).json()
        assert body["students_attempted"] == 1

    async def test_filter_by_nonexistent_code_returns_all(
        self, client, task, task_set, student_session, test_teacher, db_session
    ):
        await _add_attempt(db_session, student_session.id, task.id, task_set.id, success=True)
        response = await client.get(
            f"/api/tasks/{task.id}/statistics?task_set_code=NOCODE",
            headers=_auth(test_teacher.username),
        )
        assert response.status_code == 404

    async def test_shared_viewer_can_get_private_task_statistics_in_shared_set(
        self, client, db_session, task_set, private_task, student_session
    ):
        db_session.add(TaskSetItem(task_set_id=task_set.id, task_id=private_task.id))
        await db_session.commit()
        viewer = await _create_shared_viewer(db_session, task_set.id)

        await _add_attempt(db_session, student_session.id, private_task.id, task_set.id, success=True)

        response = await client.get(
            f"/api/tasks/{private_task.id}/statistics?task_set_code={task_set.unique_link_code}",
            headers=_auth(viewer.username),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["task_name"] == private_task.title
        assert body["students_attempted"] == 1

    async def test_shared_viewer_can_get_private_student_task_statistics_in_shared_set(
        self, client, db_session, task_set, private_task, student_session
    ):
        db_session.add(TaskSetItem(task_set_id=task_set.id, task_id=private_task.id))
        await db_session.commit()
        viewer = await _create_shared_viewer(db_session, task_set.id)

        await _add_attempt(db_session, student_session.id, private_task.id, task_set.id, success=True)

        response = await client.get(
            f"/api/students/{student_session.id}/tasks/{private_task.id}/statistics?set_id={task_set.id}",
            headers=_auth(viewer.username),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["task_name"] == private_task.title
        assert body["student_username"] == student_session.username


# ---------------------------------------------------------------------------
# Protected Pages (require authentication)
# ---------------------------------------------------------------------------

class TestProtectedPages:
    async def test_teacher_dashboard_unauthenticated(self, client):
        """Should redirect to / when not authenticated"""
        r = await client.get("/teacher-dashboard", follow_redirects=False)
        assert r.status_code == 303
        assert r.headers["location"] == "/"

    async def test_teacher_dashboard_authenticated(self, client, test_teacher):
        """Should return 200 when authenticated"""
        r = await client.get("/teacher-dashboard", headers=_auth(test_teacher.username))
        assert r.status_code == 200

    async def test_task_set_overview_unauthenticated(self, client):
        """Should redirect to / when not authenticated"""
        r = await client.get("/task-set-overview", follow_redirects=False)
        assert r.status_code == 303
        assert r.headers["location"] == "/"

    async def test_task_set_overview_authenticated(self, client, test_teacher):
        """Should return 200 when authenticated"""
        r = await client.get("/task-set-overview", headers=_auth(test_teacher.username))
        assert r.status_code == 200

    async def test_student_attempts_unauthenticated(self, client):
        """Should redirect to / when not authenticated"""
        r = await client.get("/student-attempts", follow_redirects=False)
        assert r.status_code == 303
        assert r.headers["location"] == "/"

    async def test_student_attempts_authenticated(self, client, test_teacher):
        """Should return 200 when authenticated"""
        r = await client.get("/student-attempts", headers=_auth(test_teacher.username))
        assert r.status_code == 200

    async def test_student_task_statistics_unauthenticated(self, client):
        """Should redirect to / when not authenticated"""
        r = await client.get("/student-task-statistics", follow_redirects=False)
        assert r.status_code == 303
        assert r.headers["location"] == "/"

    async def test_student_task_statistics_authenticated(self, client, test_teacher):
        """Should return 200 when authenticated"""
        r = await client.get("/student-task-statistics", headers=_auth(test_teacher.username))
        assert r.status_code == 200


# ---------------------------------------------------------------------------
# Utility helpers in main.py
# ---------------------------------------------------------------------------

class TestMainHelpers:
    def test_clean_mistake_code_trims_empty_edges(self):
        raw = "\r\n   \r\nx = 1  \r\ny = 2\r\n\r\n"
        assert utils._clean_mistake_code(raw) == "x = 1\ny = 2"

    def test_clean_mistake_code_strips_comment_only_lines(self):
        raw = "# this is a comment\nx = 1\n# another comment\n"
        assert utils._clean_mistake_code(raw) == "x = 1"

    def test_clean_mistake_code_keeps_print_lines(self):
        raw = "x = 1\nprint(x)\ny = 2\n"
        assert utils._clean_mistake_code(raw) == "x = 1\nprint(x)\ny = 2"

    def test_clean_mistake_code_strips_trailing_semicolons(self):
        raw = "x = 1;\ny = 2;\n"
        assert utils._clean_mistake_code(raw) == "x = 1\ny = 2"

    def test_mistake_code_fingerprint_empty_code_returns_empty_tuple(self):
        assert utils._mistake_code_fingerprint("\n\n  \n") == tuple()

    def test_mistake_code_fingerprint_ignores_comments(self):
        with_comment = "x = 1  # set x"
        without_comment = "x = 1"
        assert utils._mistake_code_fingerprint(with_comment) == utils._mistake_code_fingerprint(without_comment)

    def test_mistake_code_fingerprint_normalizes_quote_style(self):
        double_quotes = 'greet = "hello"'
        single_quotes = "greet = 'hello'"
        assert utils._mistake_code_fingerprint(double_quotes) == utils._mistake_code_fingerprint(single_quotes)

    def test_mistake_code_fingerprint_keeps_string_content_distinct(self):
        assert utils._mistake_code_fingerprint('"a b"') != utils._mistake_code_fingerprint('"ab"')

    def test_mistake_code_fingerprint_ignores_semicolons(self):
        semicolon_style = "x = 1; y = 2"
        newline_style = "x = 1\ny = 2"
        assert utils._mistake_code_fingerprint(semicolon_style) == utils._mistake_code_fingerprint(newline_style)

    def test_mistake_code_fingerprint_excludes_print_name(self):
        fingerprint = utils._mistake_code_fingerprint("x = 1\nprint(x)\n")
        assert not any(tok_str == "print" for _, tok_str in fingerprint)

    def test_mistake_code_fingerprint_fallback_on_token_error(self, monkeypatch):
        def _raise_token_error(_):
            raise utils.tokenize.TokenError("boom")

        monkeypatch.setattr(utils.tokenize, "generate_tokens", _raise_token_error)
        fingerprint = utils._mistake_code_fingerprint("a   b")
        assert fingerprint == ("a", "b")

    def test_generate_slug_strips_specials_and_collapses_separators(self):
        assert utils.generate_slug("  Hello__World! 2026  ") == "hello-world-2026"

    @pytest.mark.parametrize(
        "submitted_code,blocks,expected",
        [
            ("", {"blocks": []}, False),
            ("print(1)", {"blocks": []}, True),
            ("print(1)", {"blocks": ["print(1)"]}, True),
            (
                "x = 1",
                {"blocks": [{"code": "x = ___", "given": True}, {"code": "print(x)", "given": True}]},
                False,
            ),
            (
                "x = 1\nprint(x)",
                {"blocks": [{"code": "x = ___", "given": True}, {"code": "print(x)", "given": True}]},
                True,
            ),
        ],
    )
    def test_has_user_added_own_code_branches(self, submitted_code, blocks, expected):
        assert utils.has_user_added_own_code(submitted_code, blocks) is expected


# ---------------------------------------------------------------------------
# Additional endpoint branch coverage
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestDevAndMaintenanceEndpoints:
    async def test_reset_test_db_success_in_test_mode(self, client, monkeypatch):
        monkeypatch.setattr(config, "TEST_MODE", True)
        reset_mock = AsyncMock()
        seed_mock = AsyncMock()
        monkeypatch.setattr(reset_module, "reset_db", reset_mock)
        monkeypatch.setattr(seed_module, "seed_db", seed_mock)

        r = await client.post("/test/reset-db")

        assert r.status_code == 200
        assert r.json()["status"] == "success"
        reset_mock.assert_awaited_once()
        seed_mock.assert_awaited_once()

    async def test_reset_test_db_returns_500_on_error(self, client, monkeypatch):
        monkeypatch.setattr(config, "TEST_MODE", True)

        async def boom():
            raise RuntimeError("reset failed")

        monkeypatch.setattr(reset_module, "reset_db", boom)

        r = await client.post("/test/reset-db")

        assert r.status_code == 500
        assert "Failed to reset database" in r.json()["detail"]



@pytest.mark.asyncio
class TestAdditionalMainPagesAndStudentAuth:
    async def test_create_task_set_page_requires_authentication(self, client):
        r = await client.get("/create-task-set", follow_redirects=False)
        assert r.status_code == 303
        assert r.headers["location"] == "/"

    async def test_create_task_set_page_returns_200_when_authenticated(self, client, test_teacher):
        r = await client.get("/create-task-set", headers=_auth(test_teacher.username))
        assert r.status_code == 200

    async def test_create_task_page_requires_authentication(self, client):
        r = await client.get("/create-task", follow_redirects=False)
        assert r.status_code == 303
        assert r.headers["location"] == "/"

    async def test_create_task_page_returns_200_when_authenticated(self, client, test_teacher):
        r = await client.get("/create-task", headers=_auth(test_teacher.username))
        assert r.status_code == 200

    async def test_create_task_html_alias_returns_200_when_authenticated(self, client, test_teacher):
        r = await client.get("/create-task.html", headers=_auth(test_teacher.username))
        assert r.status_code == 200

    async def test_create_task_editor_page_requires_authentication(self, client):
        r = await client.get("/create-task-editor", follow_redirects=False)
        assert r.status_code == 303
        assert r.headers["location"] == "/"

    async def test_create_task_editor_page_returns_200_when_authenticated(self, client, test_teacher):
        r = await client.get("/create-task-editor", headers=_auth(test_teacher.username))
        assert r.status_code == 200

    async def test_create_task_editor_html_alias_returns_200_when_authenticated(self, client, test_teacher):
        r = await client.get("/create-task-editor.html", headers=_auth(test_teacher.username))
        assert r.status_code == 200

    async def test_task_details_page_requires_authentication(self, client):
        r = await client.get("/task-details", follow_redirects=False)
        assert r.status_code == 303
        assert r.headers["location"] == "/"

    async def test_task_details_page_returns_200_when_authenticated(self, client, test_teacher):
        r = await client.get("/task-details", headers=_auth(test_teacher.username))
        assert r.status_code == 200


    async def test_student_register_page_returns_200(self, client):
        r = await client.get("/student-register")
        assert r.status_code == 200

    async def test_student_login_invalid_credentials_returns_400(self, client):
        r = await client.post(
            "/api/student_login",
            json={"email": "ghost@example.com", "password": "wrong", "unique_link_code": None},
        )
        assert r.status_code == 400
        assert "Incorrect" in r.json()["detail"]

    async def test_student_login_accepts_email(self, client, student_session):
        r = await client.post(
            "/api/student_login",
            json={
                "email": student_session.email,
                "password": "studentpass123",
                "unique_link_code": None,
            },
        )
        assert r.status_code == 200
        assert r.json()["status"] == "success"
        assert r.json()["username"] == student_session.username
        assert "student_session" in r.cookies

    async def test_student_login_sets_cookie_and_can_rebind_task_set(
        self, client, student_session, db_session, task_set
    ):
        other_list = TaskSet(
            teacher_id=task_set.teacher_id,
            title="Week 2 Exercises",
            unique_link_code="WEEK2",
        )
        db_session.add(other_list)
        await db_session.commit()
        await db_session.refresh(other_list)

        r = await client.post(
            "/api/student_login",
            json={
                "email": student_session.email,
                "password": "studentpass123",
                "unique_link_code": "WEEK2",
            },
        )
        assert r.status_code == 200
        assert r.json()["status"] == "success"
        assert "student_session" in r.cookies

        enrollment = await db_session.execute(
            select(StudentTaskSetEnrollment).where(
                StudentTaskSetEnrollment.student_id == student_session.id,
                StudentTaskSetEnrollment.task_set_id == other_list.id,
            )
        )
        assert enrollment.scalar_one_or_none() is not None

    async def test_student_logout_clears_cookie(self, client):
        r = await client.post("/api/student_logout")
        assert r.status_code == 200
        assert "logged out" in r.json()["message"].lower()


@pytest.mark.asyncio
class TestAdditionalProblemsetAndTaskSetApis:
    async def test_my_sets_requires_authentication(self, client):
        r = await client.get("/api/my_sets")
        assert r.status_code == 401

    async def test_my_sets_returns_current_teacher_my_sets(
        self, client, test_teacher, task_set, db_session
    ):
        other_teacher = Teacher(username="otherteacher", email="otherteacher@example.com")
        other_teacher.set_password("testpassword123")
        db_session.add(other_teacher)
        await db_session.commit()
        await db_session.refresh(other_teacher)

        db_session.add(
            TaskSet(
                teacher_id=other_teacher.id,
                title="Other Teacher List",
                unique_link_code="OTHER1",
            )
        )
        await db_session.commit()

        r = await client.get("/api/my_sets", headers=_auth(test_teacher.username))
        assert r.status_code == 200
        assert {item["unique_link_code"] for item in r.json()} == {task_set.unique_link_code}

    async def test_my_sets_returns_task_and_student_counts(
        self, client, test_teacher, task_set, task, db_session
    ):
        student = Student(username="student_count_test", email="counttest@example.com")
        student.set_password("pass123")
        db_session.add(student)
        await db_session.commit()
        await db_session.refresh(student)

        db_session.add_all([
            TaskSetItem(task_set_id=task_set.id, task_id=task.id),
            StudentTaskSetEnrollment(student_id=student.id, task_set_id=task_set.id),
        ])
        await db_session.commit()

        r = await client.get("/api/my_sets", headers=_auth(test_teacher.username))
        assert r.status_code == 200
        data = r.json()
        matching = next(item for item in data if item["id"] == task_set.id)
        assert matching["task_count"] == 1
        assert matching["student_count"] == 1

    async def test_student_register_success_and_duplicate_rejected(self, client):
        payload = {
            "username": "studentx",
            "password": "studentpass123",
            "password_confirm": "studentpass123",
            "email": "studentx@example.com",
        }
        first = await client.post("/api/student_register", json=payload)
        assert first.status_code == 200
        assert first.json()["status"] == "success"

        dup = await client.post("/api/student_register", json=payload)
        assert dup.status_code == 400
        assert "already exists" in dup.json()["detail"]

    async def test_create_task_set_rejects_unknown_task_id(self, client, test_teacher):
        r = await client.post(
            "/api/create_task_set",
            headers=_auth(test_teacher.username),
            json={"title": "My New Set", "task_ids": [999999]},
        )
        assert r.status_code == 404

    async def test_create_task_set_rejects_invalid_expiration(self, client, test_teacher):
        r = await client.post(
            "/api/create_task_set",
            headers=_auth(test_teacher.username),
            json={"title": "Date Test Set", "expires_at": "invalid-date", "task_ids": []},
        )
        assert r.status_code == 400
        assert "Invalid expiration date format" in r.json()["detail"]

    async def test_create_task_set_rejects_opening_after_expiration(self, client, test_teacher):
        r = await client.post(
            "/api/create_task_set",
            headers=_auth(test_teacher.username),
            json={
                "title": "Date Order Set",
                "opens_at": "2027-01-02T00:00:00Z",
                "expires_at": "2027-01-01T00:00:00Z",
                "task_ids": [],
            },
        )
        assert r.status_code == 400
        assert "Opening date must be before or equal to expiration date" in r.json()["detail"]

    async def test_create_task_set_success_with_tasks(self, client, test_teacher, task, db_session):
        second = Parsons(
            created_by_teacher_id=test_teacher.id,
            title="Hello Again",
            description='{"description": "Two"}',
            task_instructions='{"task_instructions": "Arrange me"}',
            task_type="python",
            code_blocks={"blocks": []},
            correct_solution={"solution": []},
            is_public=True,
        )
        db_session.add(second)
        await db_session.commit()
        await db_session.refresh(second)

        payload = {
            "title": "Brand New Task Set",
            "student_description": "Student-facing",
            "teacher_description": "Teacher-facing",
            "expires_at": "2027-01-01T00:00:00Z",
            "task_ids": [task.id, second.id],
        }
        r = await client.post("/api/create_task_set", headers=_auth(test_teacher.username), json=payload)

        assert r.status_code == 200
        body = r.json()
        assert body["title"] == "Brand New Task Set"
        assert body["unique_link_code"] == "brand-new-task-set"
        assert body["expires_at"] is not None


@pytest.mark.asyncio
class TestCreateProblemApi:
    async def test_create_problem_with_blank_marks_faded_and_stores_placeholder(
        self, client, test_teacher, db_session
    ):
        payload = {
            "taskTitle": "Add In Range From Editor",
            "description": "Return the sum between start and stop.",
            "startDescription": "Practice while loops.",
            "tests": "assert add_in_range(1, 3) == 6",
            "solutionCode": "def add_in_range(start, stop):\n    total = !BLANK\n    while start <= stop:\n        total += start\n        start += 1\n    return total",
        }

        response = await client.post(
            "/api/problems",
            headers=_auth(test_teacher.username),
            json=payload,
        )

        assert response.status_code == 200
        created_id = response.json()["id"]

        result = await db_session.execute(select(Parsons).where(Parsons.id == created_id))
        created_task = result.scalar_one()

        assert created_task.task_type == "Faded"
        blocks = created_task.code_blocks["blocks"]
        assert any(block["faded"] is True for block in blocks)
        faded_block = next(block for block in blocks if block["faded"] is True)
        assert "___" in faded_block["code"]
        assert "!BLANK" not in faded_block["code"]
        assert created_task.correct_solution["solution_code"].count("!BLANK") == 1

    async def test_create_problem_without_blank_stays_normal(self, client, test_teacher, db_session):
        payload = {
            "taskTitle": "Double Value From Editor",
            "description": "Return doubled value.",
            "startDescription": "Practice function basics.",
            "tests": "assert double_value(4) == 8",
            "solutionCode": "def double_value(x):\n    return x * 2",
        }

        response = await client.post(
            "/api/problems",
            headers=_auth(test_teacher.username),
            json=payload,
        )

        assert response.status_code == 200
        created_id = response.json()["id"]

        result = await db_session.execute(select(Parsons).where(Parsons.id == created_id))
        created_task = result.scalar_one()

        assert created_task.task_type == "normal"
        blocks = created_task.code_blocks["blocks"]
        assert all(block["faded"] is False for block in blocks)

        import json
        instructions_data = json.loads(created_task.task_instructions)
        assert instructions_data["examples"] == ""

    async def test_create_problem_with_examples(self, client, test_teacher, db_session):
        payload = {
            "taskTitle": "Add In Range Task",
            "description": "Return sum of range.",
            "startDescription": "Practice loops.",
            "examples": ">>> add_in_range(3, 5)\n12",
            "tests": "assert add_in_range(3, 5) == 12",
            "solutionCode": "def add_in_range(start, stop):\n    return sum(range(start, stop + 1))",
        }

        response = await client.post(
            "/api/problems",
            headers=_auth(test_teacher.username),
            json=payload,
        )

        assert response.status_code == 200
        created_id = response.json()["id"]

        result = await db_session.execute(select(Parsons).where(Parsons.id == created_id))
        created_task = result.scalar_one()

        import json
        instructions_data = json.loads(created_task.task_instructions)
        assert instructions_data["examples"] == ">>> add_in_range(3, 5)\n12"

    async def test_create_and_update_task_set_opens_at(self, client, test_teacher, task):
        payload = {
            "title": "Opens At Test Set",
            "opens_at": "2099-01-01T12:00:00Z",
            "task_ids": [task.id],
        }
        res = await client.post(
            "/api/create_task_set",
            headers=_auth(test_teacher.username),
            json=payload,
        )
        assert res.status_code == 200
        data = res.json()
        assert data["opens_at"].startswith("2099-01-01T12:00:00")
        task_set_id = data["id"]

        # Update opens_at
        patch_res = await client.patch(
            f"/api/my_sets/{task_set_id}/opens_at",
            headers=_auth(test_teacher.username),
            json={"opens_at": "2099-06-01T12:00:00Z"},
        )
        assert patch_res.status_code == 200
        assert patch_res.json()["opens_at"].startswith("2099-06-01T12:00:00")

        # Clear opens_at
        clear_res = await client.patch(
            f"/api/my_sets/{task_set_id}/opens_at",
            headers=_auth(test_teacher.username),
            json={"opens_at": None},
        )
        assert clear_res.status_code == 200
        assert clear_res.json()["opens_at"] is None

    async def test_update_task_set_dates_rejects_invalid_order(self, client, test_teacher, task):
        res = await client.post(
            "/api/create_task_set",
            headers=_auth(test_teacher.username),
            json={
                "title": "Update Date Order Set",
                "opens_at": "2027-01-01T00:00:00Z",
                "expires_at": "2027-01-10T00:00:00Z",
                "task_ids": [task.id],
            },
        )
        assert res.status_code == 200
        task_set_id = res.json()["id"]

        expires_res = await client.patch(
            f"/api/my_sets/{task_set_id}/expires_at",
            headers=_auth(test_teacher.username),
            json={"expires_at": "2026-12-31T00:00:00Z"},
        )
        assert expires_res.status_code == 400

        opens_res = await client.patch(
            f"/api/my_sets/{task_set_id}/opens_at",
            headers=_auth(test_teacher.username),
            json={"opens_at": "2027-01-11T00:00:00Z"},
        )
        assert opens_res.status_code == 400

    async def test_student_access_blocked_before_opens_at(self, client, test_teacher, task, db_session):
        payload = {
            "title": "Future Opening Set",
            "opens_at": "2099-01-01T12:00:00Z",
            "task_ids": [task.id],
        }
        res = await client.post(
            "/api/create_task_set",
            headers=_auth(test_teacher.username),
            json=payload,
        )
        assert res.status_code == 200
        unique_code = res.json()["unique_link_code"]

        student_res = await client.get(f"/{test_teacher.username}/set/{unique_code}")
        assert student_res.status_code == 200
        assert "This task set is not open" in student_res.text


class TestContactPages:
    async def test_contact_page(self, client):
        res = await client.get("/contact")
        assert res.status_code == 200
        assert "Contact" in res.text
