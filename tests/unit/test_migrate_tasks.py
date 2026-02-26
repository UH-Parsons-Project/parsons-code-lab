"""
Unit tests for migrate_tasks utility functions and migration flow.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from backend import migrate_tasks


class TestParsingHelpers:
    """Tests for parsing helper functions."""

    def test_parse_problem_description_extracts_fields(self):
        html = (
            "<p>Write <code>add_in_range</code> function.</p>"
            "<pre><code>add_in_range(1, 3) == 6\nadd_in_range(2, 2) == 2</code></pre>"
        )

        result = migrate_tasks.parse_problem_description(html)

        assert result["function_name"] == "add_in_range"
        assert result["description"] == "Write function."
        assert "add_in_range(1, 3) == 6" in result["examples"]

    def test_parse_code_lines_handles_indent_given_and_faded(self):
        code_lines = """
for i in range(3):
    total += i #1given
    value = !BLANK
""".strip()

        blocks, has_faded = migrate_tasks.parse_code_lines(code_lines)

        assert has_faded is True
        assert len(blocks) == 3
        assert blocks[0]["id"] == "block_1"
        assert blocks[0]["indent"] == 0
        assert blocks[1]["given"] is True
        assert blocks[1]["faded"] is False
        assert blocks[2]["faded"] is True
        assert blocks[2]["code"] == "value = ___"

    def test_extract_function_signature_multiline_and_docstring(self):
        function_file = (
            "import math\n\n"
            "def my_func(\n"
            "    x: int,\n"
            "    y: int,\n"
            ") -> int:\n"
            "    \"\"\"Sum values.\"\"\"\n"
            "    return x + y\n"
        )

        signature = migrate_tasks.extract_function_signature(function_file)

        assert "def my_func(" in signature
        assert "\"\"\"Sum values.\"\"\"" in signature
        assert "return x + y" not in signature

    def test_get_function_name_handles_missing_function(self):
        assert migrate_tasks.get_function_name("def sample(x):\n    pass") == "sample"
        assert migrate_tasks.get_function_name("print('no function')") == "unknown"


class TestTaskFiles:
    """Tests for filesystem-based task loading helpers."""

    def test_load_task_file_success(self, tmp_path, monkeypatch):
        probs_dir = tmp_path / "parsons_probs"
        probs_dir.mkdir()

        yaml_content = """
problem_description: "<p>Call <code>hello</code></p><pre><code>hello() == 'hi'</code></pre>"
code_lines: |
  def hello():
      return 'hi'
test_fn: test_hello
""".strip()
        py_content = """
def hello():
    \"\"\"Say hi.\"\"\"
    return 'hi'
""".strip()

        (probs_dir / "hello_world.yaml").write_text(yaml_content)
        (probs_dir / "hello_world.py").write_text(py_content)

        monkeypatch.setattr(migrate_tasks, "PARSONS_PROBS_DIR", probs_dir)

        result = migrate_tasks.load_task_file("hello_world")

        assert result is not None
        assert result["title"] == "hello_world"
        assert result["task_type"] == "normal"
        assert result["correct_solution"]["test_function"] == "test_hello"
        assert len(result["code_blocks"]["blocks"]) == 2

    def test_load_task_file_missing_files_returns_none(self, tmp_path, monkeypatch):
        probs_dir = tmp_path / "parsons_probs"
        probs_dir.mkdir()
        monkeypatch.setattr(migrate_tasks, "PARSONS_PROBS_DIR", probs_dir)

        result = migrate_tasks.load_task_file("does_not_exist")

        assert result is None

    def test_get_task_files_returns_sorted_yaml_stems(self, tmp_path, monkeypatch):
        probs_dir = tmp_path / "parsons_probs"
        probs_dir.mkdir()

        (probs_dir / "b_task.yaml").write_text("a: 1")
        (probs_dir / "a_task.yaml").write_text("a: 1")
        (probs_dir / "ignore.py").write_text("print('x')")

        monkeypatch.setattr(migrate_tasks, "PARSONS_PROBS_DIR", probs_dir)

        result = migrate_tasks.get_task_files()

        assert result == ["a_task", "b_task"]


class _FakeSession:
    def __init__(self, fail_flush: bool = False):
        self.added = []
        self.flush_count = 0
        self.rollback_count = 0
        self.commit_count = 0
        self.fail_flush = fail_flush

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        self.flush_count += 1
        if self.fail_flush:
            raise RuntimeError("flush failed")
        if self.added:
            self.added[-1].id = 999

    async def rollback(self):
        self.rollback_count += 1

    async def commit(self):
        self.commit_count += 1


class _FakeSessionContext:
    def __init__(self, session):
        self.session = session

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        return False


class _FakeScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeQuerySession:
    def __init__(self, scalar_value):
        self.scalar_value = scalar_value

    async def execute(self, _stmt):
        return _FakeScalarResult(self.scalar_value)


class TestMigrationFlow:
    """Tests for migrate_tasks orchestration."""

    @pytest.mark.asyncio
    async def test_migrate_tasks_returns_when_no_teacher(self, monkeypatch):
        monkeypatch.setattr(
            migrate_tasks,
            "get_or_create_default_teacher",
            AsyncMock(return_value=None),
        )

        get_task_files_mock = AsyncMock()
        monkeypatch.setattr(migrate_tasks, "get_task_files", get_task_files_mock)

        await migrate_tasks.migrate_tasks()

        get_task_files_mock.assert_not_called()

    @pytest.mark.asyncio
    async def test_migrate_tasks_skips_existing_and_migrates_new(self, monkeypatch):
        teacher = SimpleNamespace(id=1, username="teacher")
        fake_session = _FakeSession()

        monkeypatch.setattr(
            migrate_tasks,
            "get_or_create_default_teacher",
            AsyncMock(return_value=teacher),
        )
        monkeypatch.setattr(migrate_tasks, "get_task_files", lambda: ["existing", "new", "bad"])

        async def fake_task_exists(title):
            return title == "existing"

        monkeypatch.setattr(migrate_tasks, "task_exists", fake_task_exists)

        def fake_load_task_file(title):
            if title == "new":
                return {
                    "title": "new",
                    "description": "{}",
                    "task_type": "normal",
                    "code_blocks": {"blocks": []},
                    "correct_solution": {"correct_order": [], "test_function": "test_new"},
                }
            return None

        monkeypatch.setattr(migrate_tasks, "load_task_file", fake_load_task_file)
        monkeypatch.setattr(
            migrate_tasks,
            "async_session",
            lambda: _FakeSessionContext(fake_session),
        )

        await migrate_tasks.migrate_tasks()

        assert fake_session.flush_count == 1
        assert fake_session.commit_count == 1
        assert len(fake_session.added) == 1
        assert fake_session.added[0].title == "new"

    @pytest.mark.asyncio
    async def test_migrate_tasks_rolls_back_on_flush_error(self, monkeypatch):
        teacher = SimpleNamespace(id=1, username="teacher")
        fake_session = _FakeSession(fail_flush=True)

        monkeypatch.setattr(
            migrate_tasks,
            "get_or_create_default_teacher",
            AsyncMock(return_value=teacher),
        )
        monkeypatch.setattr(migrate_tasks, "get_task_files", lambda: ["will_fail"])
        monkeypatch.setattr(migrate_tasks, "task_exists", AsyncMock(return_value=False))
        monkeypatch.setattr(
            migrate_tasks,
            "load_task_file",
            lambda _: {
                "title": "will_fail",
                "description": "{}",
                "task_type": "normal",
                "code_blocks": {"blocks": []},
                "correct_solution": {"correct_order": [], "test_function": "test_fail"},
            },
        )
        monkeypatch.setattr(
            migrate_tasks,
            "async_session",
            lambda: _FakeSessionContext(fake_session),
        )

        await migrate_tasks.migrate_tasks()

        assert fake_session.flush_count == 1
        assert fake_session.rollback_count == 1
        assert fake_session.commit_count == 1


class TestDatabaseQueryHelpers:
    """Tests for async DB query helper functions."""

    @pytest.mark.asyncio
    async def test_get_or_create_default_teacher_returns_teacher(self, monkeypatch):
        teacher = SimpleNamespace(id=1, username="teacher")
        session = _FakeQuerySession(teacher)

        monkeypatch.setattr(
            migrate_tasks,
            "async_session",
            lambda: _FakeSessionContext(session),
        )

        result = await migrate_tasks.get_or_create_default_teacher()

        assert result is teacher

    @pytest.mark.asyncio
    async def test_task_exists_true_and_false(self, monkeypatch):
        found_session = _FakeQuerySession(SimpleNamespace(id=123, title="Task"))
        missing_session = _FakeQuerySession(None)

        monkeypatch.setattr(
            migrate_tasks,
            "async_session",
            lambda: _FakeSessionContext(found_session),
        )
        found = await migrate_tasks.task_exists("Task")

        monkeypatch.setattr(
            migrate_tasks,
            "async_session",
            lambda: _FakeSessionContext(missing_session),
        )
        missing = await migrate_tasks.task_exists("Missing")

        assert found is True
        assert missing is False
