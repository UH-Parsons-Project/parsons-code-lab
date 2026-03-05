"""
Unit tests for backend/main.py.

Uses shared fixtures from conftest.py:
  - test_teacher / inactive_teacher  (Teacher rows)
  - task                             (a public Parsons problem)
  - private_task                     (a non-public Parsons problem)
  - problemset                       (TaskList with unique_link_code "WEEK1")
  - problemset_with_task             (problemset + task linked via TaskListItem)
  - student_session                  (StudentSession for problemset)

SQLite stores datetimes as naive, so all datetime fixtures are naive too.
"""

import uuid
from datetime import datetime

import pytest
from sqlalchemy import select

from backend.auth import create_access_token
from backend.main import app
from backend.models import Parsons, StudentSession, TaskAttempt, TaskList, TaskListItem


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _auth(username: str) -> dict:
    """Return an Authorization header dict for the given teacher username."""
    return {"Authorization": f"Bearer {create_access_token({'sub': username})}"}


def _submit(task_id: int, *, success=True, code="print(1)",
            start_time="2026-01-01T10:00:00") -> dict:
    """Build a submit-result JSON body."""
    payload = {
        "task_id": task_id,
        "success": success,
        "submitted_code": code,
        "test_output": "ok" if success else "fail",
        "repr_code": code,
    }
    if start_time is not None:
        payload["start_time"] = start_time
    return payload


async def _add_attempt(db_session, ss_id: int, task_id: int, *,
                        success: bool, code="x",
                        start=None, end=None) -> TaskAttempt:
    start = start or datetime(2026, 1, 1, 0, 0, 0)
    end = end or datetime(2026, 1, 1, 0, 1, 0)
    a = TaskAttempt(
        student_session_id=ss_id,
        task_id=task_id,
        task_started_at=start,
        completed_at=end,
        success=success,
        submitted_inputs={"code": code},
    )
    db_session.add(a)
    await db_session.commit()
    await db_session.refresh(a)
    return a


# ---------------------------------------------------------------------------
# /test/reset-db
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestResetDb:
    async def test_forbidden_when_test_mode_is_false(self, client):
        import backend.main as m
        original = m.TEST_MODE
        m.TEST_MODE = False
        try:
            r = await client.post("/test/reset-db")
            assert r.status_code == 403
        finally:
            m.TEST_MODE = original


# ---------------------------------------------------------------------------
# Static HTML pages
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestStaticPages:
    async def test_index_returns_200(self, client):
        assert (await client.get("/")).status_code == 200

    async def test_index_html_returns_200(self, client):
        assert (await client.get("/index.html")).status_code == 200

    async def test_problem_html_returns_200(self, client):
        assert (await client.get("/problem.html")).status_code == 200

    async def test_register_page_returns_200(self, client):
        assert (await client.get("/register")).status_code == 200

    async def test_student_start_page_returns_200(self, client):
        assert (await client.get("/student_start_page")).status_code == 200

    async def test_exerciselist_unauthenticated_redirects(self, client):
        r = await client.get("/exerciselist", follow_redirects=False)
        assert r.status_code == 303
        assert "/index.html" in r.headers["location"]

    async def test_exerciselist_authenticated_returns_200(self, client, test_teacher):
        r = await client.get("/exerciselist", headers=_auth(test_teacher.username))
        assert r.status_code == 200

    async def test_statics_view_unauthenticated_redirects(self, client):
        r = await client.get("/statics_view", follow_redirects=False)
        assert r.status_code == 303
        assert "/index.html" in r.headers["location"]

    async def test_statics_view_authenticated_returns_200(self, client, test_teacher):
        r = await client.get("/statics_view", headers=_auth(test_teacher.username))
        assert r.status_code == 200


# ---------------------------------------------------------------------------
# /set/{unique_link_code}  and sub-pages
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestProblemsetPages:
    async def test_unknown_code_returns_404(self, client):
        assert (await client.get("/set/NOCODE")).status_code == 404

    async def test_no_session_serves_nickname_page(self, client, problemset):
        r = await client.get(f"/set/{problemset.unique_link_code}", follow_redirects=False)
        assert r.status_code == 200

    async def test_active_session_redirects_to_tasks(self, client, problemset, student_session):
        client.cookies.set("student_session", str(student_session.session_id))
        r = await client.get(f"/set/{problemset.unique_link_code}", follow_redirects=False)
        client.cookies.clear()
        assert r.status_code == 303
        assert "/tasks" in r.headers["location"]

    async def test_tasks_page_unknown_code_returns_404(self, client):
        assert (await client.get("/set/NOCODE/tasks")).status_code == 404

    async def test_tasks_page_returns_200(self, client, problemset):
        assert (await client.get(f"/set/{problemset.unique_link_code}/tasks")).status_code == 200

    async def test_task_page_unknown_code_returns_404(self, client):
        assert (await client.get("/set/NOCODE/tasks/1")).status_code == 404

    async def test_task_page_returns_200(self, client, problemset, task):
        assert (await client.get(f"/set/{problemset.unique_link_code}/tasks/{task.id}")).status_code == 200

    async def test_description_page_unknown_code_returns_404(self, client):
        assert (await client.get("/set/NOCODE/tasks/1/description")).status_code == 404

    async def test_description_page_returns_200(self, client, problemset, task):
        assert (await client.get(f"/set/{problemset.unique_link_code}/tasks/{task.id}/description")).status_code == 200

    async def test_start_page_unknown_code_returns_404(self, client):
        assert (await client.get("/set/NOCODE/tasks/1/start")).status_code == 404

    async def test_start_page_returns_200(self, client, problemset, task):
        assert (await client.get(f"/set/{problemset.unique_link_code}/tasks/{task.id}/start")).status_code == 200


# ---------------------------------------------------------------------------
# POST /api/login/access-token
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestLogin:
    async def test_valid_credentials_return_token(self, client, test_teacher):
        r = await client.post(
            "/api/login/access-token",
            data={"username": "testteacher", "password": "testpassword123"},
        )
        assert r.status_code == 200
        assert "access_token" in r.json()
        assert r.json()["token_type"] == "bearer"

    async def test_valid_login_sets_cookie(self, client, test_teacher):
        r = await client.post(
            "/api/login/access-token",
            data={"username": "testteacher", "password": "testpassword123"},
        )
        assert "access_token" in r.cookies

    async def test_wrong_password_returns_400(self, client, test_teacher):
        r = await client.post(
            "/api/login/access-token",
            data={"username": "testteacher", "password": "wrong"},
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
        assert r.json() == {"username": "testteacher", "email": "test@example.com"}

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
    _valid = {
        "username": "newteacher",
        "password": "password123",
        "password_confirm": "password123",
        "email": "new@example.com",
    }

    async def test_valid_registration_succeeds(self, client):
        r = await client.post("/api/register", json=self._valid)
        assert r.status_code == 200
        assert r.json()["status"] == "success"

    async def test_invalid_json_returns_400(self, client):
        r = await client.post(
            "/api/register",
            content=b"not-json",
            headers={"Content-Type": "application/json"},
        )
        assert r.status_code == 400

    async def test_empty_username_returns_400(self, client):
        r = await client.post("/api/register", json={**self._valid, "username": ""})
        assert r.status_code == 400
        assert "required" in r.json()["detail"]

    async def test_empty_password_returns_400(self, client):
        r = await client.post("/api/register",
                               json={**self._valid, "password": "", "password_confirm": ""})
        assert r.status_code == 400

    async def test_empty_email_returns_400(self, client):
        r = await client.post("/api/register", json={**self._valid, "email": ""})
        assert r.status_code == 400

    async def test_password_mismatch_returns_400(self, client):
        r = await client.post("/api/register",
                               json={**self._valid, "password_confirm": "different"})
        assert r.status_code == 400
        assert "Passwords do not match" in r.json()["detail"]

    async def test_username_too_long_returns_400(self, client):
        r = await client.post("/api/register", json={**self._valid, "username": "a" * 51})
        assert r.status_code == 400
        assert "too long" in r.json()["detail"]

    async def test_email_too_long_returns_400(self, client):
        r = await client.post("/api/register",
                               json={**self._valid, "email": "a" * 101 + "@x.com"})
        assert r.status_code == 400
        assert "too long" in r.json()["detail"]

    async def test_username_too_short_returns_400(self, client):
        r = await client.post("/api/register", json={**self._valid, "username": "ab"})
        assert r.status_code == 400
        assert "minimum length" in r.json()["detail"]

    async def test_password_too_short_returns_400(self, client):
        r = await client.post("/api/register",
                               json={**self._valid, "password": "short", "password_confirm": "short"})
        assert r.status_code == 400
        assert "minimum length" in r.json()["detail"]

    async def test_duplicate_username_returns_400(self, client, test_teacher):
        payload = {**self._valid, "username": "testteacher", "email": "other@example.com"}
        r = await client.post("/api/register", json=payload)
        assert r.status_code == 400
        assert "already exists" in r.json()["detail"]

    async def test_duplicate_email_returns_400(self, client, test_teacher):
        payload = {**self._valid, "username": "uniqueuser9", "email": "test@example.com"}
        r = await client.post("/api/register", json=payload)
        assert r.status_code == 400
        assert "already exists" in r.json()["detail"]

    async def test_whitespace_username_treated_as_empty(self, client):
        r = await client.post("/api/register", json={**self._valid, "username": "   "})
        assert r.status_code == 400

    async def test_whitespace_email_treated_as_empty(self, client):
        r = await client.post("/api/register", json={**self._valid, "email": "   "})
        assert r.status_code == 400


# ---------------------------------------------------------------------------
# POST /api/validate-nickname
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestValidateNickname:
    async def test_valid_nickname_returns_session_id(self, client, problemset):
        r = await client.post("/api/validate-nickname",
                               json={"nickname": "Alice",
                                     "unique_link_code": problemset.unique_link_code})
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "valid"
        assert body["nickname"] == "Alice"
        assert "session_id" in body

    async def test_nickname_is_trimmed(self, client, problemset):
        r = await client.post("/api/validate-nickname",
                               json={"nickname": "  Bob  ",
                                     "unique_link_code": problemset.unique_link_code})
        assert r.status_code == 200
        assert r.json()["nickname"] == "Bob"

    async def test_whitespace_only_nickname_returns_400(self, client, problemset):
        r = await client.post("/api/validate-nickname",
                               json={"nickname": "   ",
                                     "unique_link_code": problemset.unique_link_code})
        assert r.status_code == 400
        assert "empty" in r.json()["detail"].lower()

    async def test_nickname_too_long_returns_400(self, client, problemset):
        r = await client.post("/api/validate-nickname",
                               json={"nickname": "a" * 21,
                                     "unique_link_code": problemset.unique_link_code})
        assert r.status_code == 400

    async def test_nickname_at_max_length_succeeds(self, client, problemset):
        r = await client.post("/api/validate-nickname",
                               json={"nickname": "a" * 20,
                                     "unique_link_code": problemset.unique_link_code})
        assert r.status_code == 200

    async def test_unknown_task_list_returns_404(self, client):
        r = await client.post("/api/validate-nickname",
                               json={"nickname": "Alice", "unique_link_code": "NOEXIST"})
        assert r.status_code == 404

    async def test_sets_session_cookie(self, client, problemset):
        r = await client.post("/api/validate-nickname",
                               json={"nickname": "Cookie",
                                     "unique_link_code": problemset.unique_link_code})
        assert r.status_code == 200
        assert "student_session" in r.cookies


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

    async def test_task_without_instructions_returns_null(self, client, db_session, test_teacher):
        t = Parsons(
            created_by_teacher_id=test_teacher.id, title="NoInstr", task_type="python",
            description='{}', code_blocks={}, correct_solution={}, is_public=True,
        )
        db_session.add(t)
        await db_session.commit()
        await db_session.refresh(t)
        r = await client.get(f"/api/tasks/{t.id}")
        assert r.status_code == 200
        assert r.json()["task_instructions"] is None

    async def test_nonexistent_task_returns_404(self, client):
        assert (await client.get("/api/tasks/99999")).status_code == 404


# ---------------------------------------------------------------------------
# GET /api/tasks  — list public tasks
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestListTasks:
    async def test_includes_public_excludes_private(self, client, task, private_task):
        r = await client.get("/api/tasks")
        assert r.status_code == 200
        ids = [t["id"] for t in r.json()]
        assert task.id in ids
        assert private_task.id not in ids

    async def test_parses_json_description_field(self, client, task):
        r = await client.get("/api/tasks")
        found = next(t for t in r.json() if t["id"] == task.id)
        assert found["description"] == "Print hello world."

    async def test_invalid_json_description_returns_empty_string(self, client, db_session, test_teacher):
        t = Parsons(
            created_by_teacher_id=test_teacher.id, title="BadJson", task_type="python",
            description="not-json", code_blocks={}, correct_solution={}, is_public=True,
        )
        db_session.add(t)
        await db_session.commit()
        r = await client.get("/api/tasks")
        found = next(t for t in r.json() if t["title"] == "BadJson")
        assert found["description"] == ""

    async def test_empty_description_string_returns_empty(self, client, db_session, test_teacher):
        t = Parsons(
            created_by_teacher_id=test_teacher.id, title="EmptyStr", task_type="python",
            description="", code_blocks={}, correct_solution={}, is_public=True,
        )
        db_session.add(t)
        await db_session.commit()
        r = await client.get("/api/tasks")
        found = next(t for t in r.json() if t["title"] == "EmptyStr")
        assert found["description"] == ""


# ---------------------------------------------------------------------------
# GET /api/problemsets/{id}
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestGetProblemset:
    async def test_returns_problemset_data(self, client, problemset):
        r = await client.get(f"/api/problemsets/{problemset.id}")
        assert r.status_code == 200
        body = r.json()
        assert body["id"] == problemset.id
        assert body["unique_link_code"] == "WEEK1"
        assert body["expires_at"] is None

    async def test_problemset_with_expires_at(self, client, db_session, test_teacher):
        from datetime import timezone
        ps = TaskList(
            teacher_id=test_teacher.id, title="Expiring", unique_link_code="EXP01",
            expires_at=datetime(2027, 1, 1, tzinfo=timezone.utc),
        )
        db_session.add(ps)
        await db_session.commit()
        await db_session.refresh(ps)
        r = await client.get(f"/api/problemsets/{ps.id}")
        assert r.status_code == 200
        assert r.json()["expires_at"] is not None

    async def test_nonexistent_returns_404(self, client):
        assert (await client.get("/api/problemsets/99999")).status_code == 404


# ---------------------------------------------------------------------------
# GET /api/problemsets/{code}/tasks
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestGetProblemsetTasks:
    async def test_get_by_string_code(self, client, problemset_with_task):
        ps, task = problemset_with_task
        r = await client.get(f"/api/problemsets/{ps.unique_link_code}/tasks")
        assert r.status_code == 200
        assert len(r.json()) == 1
        assert r.json()[0]["id"] == task.id

    async def test_get_by_numeric_id(self, client, problemset_with_task):
        ps, task = problemset_with_task
        r = await client.get(f"/api/problemsets/{ps.id}/tasks")
        assert r.status_code == 200
        assert r.json()[0]["id"] == task.id

    async def test_unknown_code_returns_404(self, client):
        assert (await client.get("/api/problemsets/NOSUCHCODE/tasks")).status_code == 404

    async def test_unknown_id_returns_404(self, client):
        assert (await client.get("/api/problemsets/99999/tasks")).status_code == 404

    async def test_empty_problemset_returns_empty_list(self, client, problemset):
        r = await client.get(f"/api/problemsets/{problemset.unique_link_code}/tasks")
        assert r.status_code == 200
        assert r.json() == []


# ---------------------------------------------------------------------------
# POST /api/tasks/{task_id}/submit-result
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestSubmitResult:
    async def test_no_session_returns_401(self, client, task):
        r = await client.post(f"/api/tasks/{task.id}/submit-result",
                               json=_submit(task.id))
        assert r.status_code == 401

    async def test_success_with_iso_start_time(self, client, task, student_session):
        client.cookies.set("student_session", str(student_session.session_id))
        r = await client.post(f"/api/tasks/{task.id}/submit-result",
                               json=_submit(task.id, success=True,
                                            start_time="2026-03-01T10:00:00"))
        client.cookies.clear()
        assert r.status_code == 200
        assert r.json()["status"] == "success"

    async def test_success_with_z_suffix_timestamp(self, client, task, student_session):
        client.cookies.set("student_session", str(student_session.session_id))
        r = await client.post(f"/api/tasks/{task.id}/submit-result",
                               json=_submit(task.id, start_time="2026-03-01T10:00:00Z"))
        client.cookies.clear()
        assert r.status_code == 200

    async def test_invalid_start_time_falls_back_to_now(self, client, task, student_session):
        client.cookies.set("student_session", str(student_session.session_id))
        r = await client.post(f"/api/tasks/{task.id}/submit-result",
                               json=_submit(task.id, start_time="not-a-date"))
        client.cookies.clear()
        assert r.status_code == 200

    async def test_missing_start_time_uses_now(self, client, task, student_session):
        client.cookies.set("student_session", str(student_session.session_id))
        r = await client.post(f"/api/tasks/{task.id}/submit-result",
                               json=_submit(task.id, start_time=None))
        client.cookies.clear()
        assert r.status_code == 200

    async def test_attempt_persisted_in_db(self, client, task, student_session, db_session):
        client.cookies.set("student_session", str(student_session.session_id))
        await client.post(f"/api/tasks/{task.id}/submit-result",
                          json=_submit(task.id, success=True, code="my_answer",
                                       start_time="2026-01-01T00:00:00"))
        client.cookies.clear()
        result = await db_session.execute(
            select(TaskAttempt).where(TaskAttempt.task_id == task.id)
        )
        attempt = result.scalar_one()
        assert attempt.success is True
        assert attempt.submitted_inputs["code"] == "my_answer"

    async def test_failure_attempt_persisted(self, client, task, student_session, db_session):
        client.cookies.set("student_session", str(student_session.session_id))
        await client.post(f"/api/tasks/{task.id}/submit-result",
                          json=_submit(task.id, success=False, code="wrong",
                                       start_time="2026-01-01T00:00:00"))
        client.cookies.clear()
        result = await db_session.execute(
            select(TaskAttempt).where(TaskAttempt.task_id == task.id)
        )
        attempt = result.scalar_one()
        assert attempt.success is False


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
        assert body["time_to_first_success"] == {"avg": 0, "min": 0, "max": 0}

    async def test_single_success_calculates_time_correctly(
        self, client, task, student_session, test_teacher, db_session
    ):
        await _add_attempt(db_session, student_session.id, task.id, success=True,
                            start=datetime(2026, 1, 1, 0, 0, 0),
                            end=datetime(2026, 1, 1, 0, 2, 0))
        r = await client.get(f"/api/tasks/{task.id}/statistics",
                              headers=_auth(test_teacher.username))
        body = r.json()
        assert body["total_completions"] == 1
        assert body["students_completed"] == 1
        assert body["avg_tries"] == 1
        assert body["time_to_first_success"]["avg"] == 120.0

    async def test_failures_before_success_counted_correctly(
        self, client, task, student_session, test_teacher, db_session
    ):
        for i in range(2):
            await _add_attempt(db_session, student_session.id, task.id, success=False,
                                code=f"wrong_{i}",
                                start=datetime(2026, 1, 1, 0, i, 0),
                                end=datetime(2026, 1, 1, 0, i, 30))
        await _add_attempt(db_session, student_session.id, task.id, success=True,
                            start=datetime(2026, 1, 1, 0, 3, 0),
                            end=datetime(2026, 1, 1, 0, 4, 0))
        body = (await client.get(f"/api/tasks/{task.id}/statistics",
                                  headers=_auth(test_teacher.username))).json()
        assert body["total_completions"] == 3
        assert body["students_completed"] == 1
        assert body["avg_tries"] == 3          # success was on attempt #3
        assert body["time_to_first_fail"]["avg"] == 30.0

    async def test_all_failures_no_completions(
        self, client, task, student_session, test_teacher, db_session
    ):
        for i in range(3):
            await _add_attempt(db_session, student_session.id, task.id, success=False,
                                code="wrong",
                                start=datetime(2026, 1, 1, 0, i, 0),
                                end=datetime(2026, 1, 1, 0, i, 30))
        body = (await client.get(f"/api/tasks/{task.id}/statistics",
                                  headers=_auth(test_teacher.username))).json()
        assert body["students_completed"] == 0
        assert body["avg_tries"] == 0
        assert body["time_to_first_success"]["avg"] == 0

    async def test_multiple_students_aggregated(
        self, client, task, problemset, test_teacher, db_session
    ):
        for i in range(3):
            ss = StudentSession(
                session_id=uuid.uuid4(), task_list_id=problemset.id, username=f"S{i}"
            )
            db_session.add(ss)
            await db_session.commit()
            await db_session.refresh(ss)
            await _add_attempt(db_session, ss.id, task.id, success=True,
                                start=datetime(2026, 1, 1, 0, 0, 0),
                                end=datetime(2026, 1, 1, 0, i + 1, 0))
        body = (await client.get(f"/api/tasks/{task.id}/statistics",
                                  headers=_auth(test_teacher.username))).json()
        assert body["students_attempted"] == 3
        assert body["students_completed"] == 3
        assert body["time_to_first_success"]["min"] == 60.0
        assert body["time_to_first_success"]["max"] == 180.0
        assert body["time_to_first_success"]["avg"] == 120.0

    async def test_common_mistakes_sorted_by_frequency(
        self, client, task, student_session, test_teacher, db_session
    ):
        await _add_attempt(db_session, student_session.id, task.id, success=False, code="bad")
        await _add_attempt(db_session, student_session.id, task.id, success=False, code="bad")
        await _add_attempt(db_session, student_session.id, task.id, success=False, code="worse")
        await _add_attempt(db_session, student_session.id, task.id, success=True, code="good")
        body = (await client.get(f"/api/tasks/{task.id}/statistics",
                                  headers=_auth(test_teacher.username))).json()
        mistakes = body["common_mistakes"]
        assert mistakes[0]["code"] == "bad"
        assert mistakes[0]["count"] == 2

    async def test_common_mistakes_capped_at_five(
        self, client, task, student_session, test_teacher, db_session
    ):
        for i in range(7):
            await _add_attempt(db_session, student_session.id, task.id,
                                success=False, code=f"mistake_{i}")
        body = (await client.get(f"/api/tasks/{task.id}/statistics",
                                  headers=_auth(test_teacher.username))).json()
        assert len(body["common_mistakes"]) <= 5

    async def test_attempt_missing_code_key_not_a_mistake(
        self, client, task, student_session, test_teacher, db_session
    ):
        a = TaskAttempt(
            student_session_id=student_session.id, task_id=task.id,
            task_started_at=datetime(2026, 1, 1), completed_at=datetime(2026, 1, 1, 0, 1),
            success=False, submitted_inputs={},   # no "code" key
        )
        db_session.add(a)
        await db_session.commit()
        body = (await client.get(f"/api/tasks/{task.id}/statistics",
                                  headers=_auth(test_teacher.username))).json()
        assert body["common_mistakes"] == []

    async def test_attempt_with_null_submitted_inputs(
        self, client, task, student_session, test_teacher, db_session
    ):
        a = TaskAttempt(
            student_session_id=student_session.id, task_id=task.id,
            task_started_at=datetime(2026, 1, 1), completed_at=datetime(2026, 1, 1, 0, 1),
            success=False, submitted_inputs=None,
        )
        db_session.add(a)
        await db_session.commit()
        body = (await client.get(f"/api/tasks/{task.id}/statistics",
                                  headers=_auth(test_teacher.username))).json()
        assert body["common_mistakes"] == []

    async def test_filter_by_problemset_isolates_students(
        self, client, task, problemset, student_session, test_teacher, db_session
    ):
        # second problemset + student
        ps2 = TaskList(
            teacher_id=test_teacher.id, title="PS2", unique_link_code="WEEK2"
        )
        db_session.add(ps2)
        await db_session.commit()
        await db_session.refresh(ps2)
        ss2 = StudentSession(session_id=uuid.uuid4(), task_list_id=ps2.id, username="Other")
        db_session.add(ss2)
        await db_session.commit()
        await db_session.refresh(ss2)

        await _add_attempt(db_session, student_session.id, task.id, success=True)
        await _add_attempt(db_session, ss2.id, task.id, success=True)

        body = (await client.get(
            f"/api/tasks/{task.id}/statistics?problemset_code={problemset.unique_link_code}",
            headers=_auth(test_teacher.username),
        )).json()
        assert body["students_attempted"] == 1

    async def test_filter_by_nonexistent_code_returns_all(
        self, client, task, student_session, test_teacher, db_session
    ):
        await _add_attempt(db_session, student_session.id, task.id, success=True)
        body = (await client.get(
            f"/api/tasks/{task.id}/statistics?problemset_code=NOCODE",
            headers=_auth(test_teacher.username),
        )).json()
        assert body["total_completions"] == 1
