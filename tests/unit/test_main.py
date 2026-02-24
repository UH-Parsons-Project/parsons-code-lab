"""
Unit tests for main API endpoints.
"""

from unittest.mock import AsyncMock

from fastapi import status

from backend import main as main_module
from backend.auth import create_access_token
from backend.models import Parsons


class TestStaticPages:
    """Tests for static page endpoints."""

    async def test_index_page(self, client):
        """Test that the index page loads."""
        response = await client.get("/")
        assert response.status_code == status.HTTP_200_OK

    async def test_index_html_explicit(self, client):
        """Test that index.html loads explicitly."""
        response = await client.get("/index.html")
        assert response.status_code == status.HTTP_200_OK

    async def test_problem_page(self, client):
        """Test that the problem page loads."""
        response = await client.get("/problem.html")
        assert response.status_code == status.HTTP_200_OK

    async def test_nickname_page(self, client):
        """Test that the nickname page loads."""
        response = await client.get("/nickname")
        assert response.status_code == status.HTTP_200_OK

    async def test_student_start_page(self, client):
        """Test that the student start page loads."""
        response = await client.get("/student_start_page")
        assert response.status_code == status.HTTP_200_OK


class TestProtectedPages:
    """Tests for protected page endpoints that require authentication."""

    async def test_exercise_list_without_auth(self, client):
        """Test that exercise list redirects when not authenticated."""
        response = await client.get("/exerciselist", follow_redirects=False)
        assert response.status_code == status.HTTP_303_SEE_OTHER
        assert response.headers["location"] == "/index.html"

    async def test_exercise_list_with_auth(self, client, test_teacher):
        """Test that exercise list loads for authenticated users."""
        token = create_access_token({"sub": test_teacher.username})
        client.cookies.set("access_token", token)
        response = await client.get("/exerciselist")
        client.cookies.clear()
        assert response.status_code == status.HTTP_200_OK
        assert "no-store" in response.headers.get("cache-control", "")

    async def test_statics_view_without_auth(self, client):
        """Test that statics view redirects when not authenticated."""
        response = await client.get("/statics_view", follow_redirects=False)
        assert response.status_code == status.HTTP_303_SEE_OTHER
        assert response.headers["location"] == "/index.html"

    async def test_statics_view_with_auth(self, client, test_teacher):
        """Test that statics view loads for authenticated users."""
        token = create_access_token({"sub": test_teacher.username})
        client.cookies.set("access_token", token)
        response = await client.get("/statics_view")
        client.cookies.clear()
        assert response.status_code == status.HTTP_200_OK
        assert "no-store" in response.headers.get("cache-control", "")


class TestLoginEndpoint:
    """Tests for login endpoint."""

    async def test_login_with_valid_credentials(self, client, test_teacher):
        """Test login with valid username and password."""
        response = await client.post(
            "/api/login/access-token",
            data={
                "username": "testteacher",
                "password": "testpassword123"
            }
        )

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"

        # Check that cookie is set
        assert "access_token" in response.cookies

    async def test_login_with_invalid_username(self, client):
        """Test login with non-existent username."""
        response = await client.post(
            "/api/login/access-token",
            data={
                "username": "nonexistent",
                "password": "testpassword123"
            }
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "Incorrect username or password" in response.json()["detail"]

    async def test_login_with_invalid_password(self, client, test_teacher):
        """Test login with wrong password."""
        response = await client.post(
            "/api/login/access-token",
            data={
                "username": "testteacher",
                "password": "wrongpassword"
            }
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "Incorrect username or password" in response.json()["detail"]

    async def test_login_with_inactive_user(self, client, inactive_teacher):
        """Test login with inactive user account."""
        response = await client.post(
            "/api/login/access-token",
            data={
                "username": "inactiveteacher",
                "password": "testpassword123"
            }
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        # Inactive users are treated as invalid credentials for security
        assert "Incorrect username or password" in response.json()["detail"]

    async def test_login_with_empty_credentials(self, client):
        """Test login with empty username and password."""
        response = await client.post(
            "/api/login/access-token",
            data={
                "username": "",
                "password": ""
            }
        )

        # FastAPI validates form data and returns 422 for empty required fields
        assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT


class TestCurrentUserEndpoint:
    """Tests for current user info endpoint."""

    async def test_get_current_user_info_with_auth(self, client, test_teacher):
        """Test getting current user info when authenticated."""
        token = create_access_token({"sub": test_teacher.username})

        response = await client.get(
            "/api/me",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["username"] == test_teacher.username
        assert data["email"] == test_teacher.email

    async def test_get_current_user_info_without_auth(self, client):
        """Test getting current user info without authentication."""
        response = await client.get("/api/me")

        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    async def test_get_current_user_info_with_invalid_token(self, client):
        """Test getting current user info with invalid token."""
        response = await client.get(
            "/api/me",
            headers={"Authorization": "Bearer invalid_token"}
        )

        assert response.status_code == status.HTTP_401_UNAUTHORIZED


class TestLogoutEndpoint:
    """Tests for logout endpoint."""

    async def test_logout(self, client):
        """Test logout clears the access token cookie."""
        response = await client.post("/api/logout")

        assert response.status_code == status.HTTP_200_OK
        assert response.json()["message"] == "Successfully logged out"

        # Check that cookie is deleted (set to empty or expired)
        if "access_token" in response.cookies:
            assert response.cookies["access_token"] == "" or \
                   response.cookies.get("max-age") == "0"

    async def test_logout_without_prior_login(self, client):
        """Test logout works even without being logged in."""
        response = await client.post("/api/logout")

        assert response.status_code == status.HTTP_200_OK
        assert response.json()["message"] == "Successfully logged out"


class TestCORSConfiguration:
    """Tests for CORS middleware configuration."""

    async def test_cors_headers_present(self, client):
        """Test that CORS headers are present in responses."""
        response = await client.options(
            "/api/me",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "GET"
            }
        )

        # CORS middleware should handle OPTIONS requests
        assert response.status_code in [status.HTTP_200_OK, status.HTTP_204_NO_CONTENT]


class TestIntegrationScenarios:
    """Integration tests for common user workflows."""

    async def test_complete_login_and_access_flow(self, client, test_teacher):
        """Test complete flow: login, access protected resource, logout."""
        # Step 1: Login
        login_response = await client.post(
            "/api/login/access-token",
            data={
                "username": "testteacher",
                "password": "testpassword123"
            }
        )
        assert login_response.status_code == status.HTTP_200_OK
        token = login_response.json()["access_token"]

        # Step 2: Access user info
        me_response = await client.get(
            "/api/me",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert me_response.status_code == status.HTTP_200_OK
        assert me_response.json()["username"] == "testteacher"

        # Step 3: Access protected page
        client.cookies.set("access_token", token)
        exercise_response = await client.get("/exerciselist")
        client.cookies.clear()
        assert exercise_response.status_code == status.HTTP_200_OK

        # Step 4: Logout
        logout_response = await client.post("/api/logout")
        assert logout_response.status_code == status.HTTP_200_OK


class TestTasksEndpoints:
    """Tests for tasks API endpoints."""

    async def test_get_task_by_id_success(self, client, db_session, test_teacher):
        """Test that a task can be fetched by ID."""
        task = Parsons(
            created_by_teacher_id=test_teacher.id,
            title="Sample Task",
            description='{"description": "Solve this task"}',
            task_type="python",
            code_blocks={"blocks": ["print('hello')"]},
            correct_solution={"solution": ["print('hello')"]},
            is_public=True,
        )
        db_session.add(task)
        await db_session.commit()
        await db_session.refresh(task)

        response = await client.get(f"/api/tasks/{task.id}")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["id"] == task.id
        assert data["title"] == "Sample Task"
        assert data["description"] == '{"description": "Solve this task"}'
        assert data["task_type"] == "python"
        assert data["is_public"] is True
        assert "created_at" in data

    async def test_get_task_by_id_not_found(self, client):
        """Test that unknown task ID returns 404."""
        response = await client.get("/api/tasks/999999")

        assert response.status_code == status.HTTP_404_NOT_FOUND
        assert "Task with id 999999 not found" in response.json()["detail"]

    async def test_list_tasks_returns_only_public_tasks(
        self, client, db_session, test_teacher
    ):
        """Test that task listing excludes private tasks."""
        public_task = Parsons(
            created_by_teacher_id=test_teacher.id,
            title="Public Task",
            description='{"description": "Visible"}',
            task_type="python",
            code_blocks={"blocks": ["a"]},
            correct_solution={"solution": ["a"]},
            is_public=True,
        )
        private_task = Parsons(
            created_by_teacher_id=test_teacher.id,
            title="Private Task",
            description='{"description": "Hidden"}',
            task_type="python",
            code_blocks={"blocks": ["b"]},
            correct_solution={"solution": ["b"]},
            is_public=False,
        )
        db_session.add(public_task)
        db_session.add(private_task)
        await db_session.commit()

        response = await client.get("/api/tasks")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert isinstance(data, list)
        titles = [item["title"] for item in data]
        assert "Public Task" in titles
        assert "Private Task" not in titles

    async def test_list_tasks_parses_description_json(
        self, client, db_session, test_teacher
    ):
        """Test that /api/tasks extracts description text from JSON."""
        task = Parsons(
            created_by_teacher_id=test_teacher.id,
            title="JSON Description Task",
            description='{"description": "Readable description"}',
            task_type="python",
            code_blocks={"blocks": ["c"]},
            correct_solution={"solution": ["c"]},
            is_public=True,
        )
        db_session.add(task)
        await db_session.commit()

        response = await client.get("/api/tasks")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        task_payload = next(item for item in data if item["title"] == task.title)
        assert task_payload["description"] == "Readable description"

    async def test_list_tasks_invalid_description_json_returns_empty_description(
        self, client, db_session, test_teacher
    ):
        """Test that invalid JSON descriptions are handled gracefully."""
        task = Parsons(
            created_by_teacher_id=test_teacher.id,
            title="Broken Description Task",
            description="this is not valid json",
            task_type="python",
            code_blocks={"blocks": ["d"]},
            correct_solution={"solution": ["d"]},
            is_public=True,
        )
        db_session.add(task)
        await db_session.commit()

        response = await client.get("/api/tasks")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        task_payload = next(item for item in data if item["title"] == task.title)
        assert task_payload["description"] == ""


class TestTestModeEndpoint:
    """Tests for test-only reset database endpoint."""

    async def test_reset_test_db_returns_403_when_test_mode_disabled(
        self, client, monkeypatch
    ):
        """Test that endpoint is blocked when TEST_MODE is false."""
        monkeypatch.setattr(main_module, "TEST_MODE", False)

        response = await client.post("/test/reset-db")

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert "only available in test mode" in response.json()["detail"]

    async def test_reset_test_db_success_when_test_mode_enabled(
        self, client, monkeypatch
    ):
        """Test successful DB reset flow in test mode."""
        monkeypatch.setattr(main_module, "TEST_MODE", True)
        reset_mock = AsyncMock()
        seed_mock = AsyncMock()
        monkeypatch.setattr(main_module, "reset_db", reset_mock)
        monkeypatch.setattr(main_module, "seed_db", seed_mock)

        response = await client.post("/test/reset-db")

        assert response.status_code == status.HTTP_200_OK
        assert response.json()["status"] == "success"
        reset_mock.assert_awaited_once()
        seed_mock.assert_awaited_once()

    async def test_reset_test_db_returns_500_on_exception(self, client, monkeypatch):
        """Test reset endpoint returns 500 when reset fails."""
        monkeypatch.setattr(main_module, "TEST_MODE", True)
        failing_reset = AsyncMock(side_effect=RuntimeError("boom"))
        seed_mock = AsyncMock()
        monkeypatch.setattr(main_module, "reset_db", failing_reset)
        monkeypatch.setattr(main_module, "seed_db", seed_mock)

        response = await client.post("/test/reset-db")

        assert response.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
        assert "Failed to reset database" in response.json()["detail"]
        seed_mock.assert_not_awaited()