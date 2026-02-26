"""Unit tests for backend.reset_db module."""

from unittest.mock import AsyncMock

import pytest

from backend import reset_db as reset_db_module


class _FakeConnection:
    def __init__(self):
        self.calls = []

    async def run_sync(self, fn, *args, **kwargs):
        self.calls.append((fn, args, kwargs))


class _FakeBeginContext:
    def __init__(self, conn):
        self.conn = conn

    async def __aenter__(self):
        return self.conn

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        return False


class _FakeEngine:
    def __init__(self, conn):
        self.conn = conn
        self.dispose = AsyncMock()

    def begin(self):
        return _FakeBeginContext(self.conn)


class TestResetDb:
    """Tests for reset_db operations."""

    @pytest.mark.asyncio
    async def test_reset_db_drops_then_creates_tables_with_checkfirst(self, monkeypatch):
        fake_conn = _FakeConnection()
        fake_engine = _FakeEngine(fake_conn)
        monkeypatch.setattr(reset_db_module, "engine", fake_engine)

        await reset_db_module.reset_db()

        assert len(fake_conn.calls) == 2

        drop_call = fake_conn.calls[0]
        create_call = fake_conn.calls[1]

        assert drop_call[0].__name__ == "drop_all"
        assert drop_call[2]["checkfirst"] is True

        assert create_call[0].__name__ == "create_all"
        assert create_call[2]["checkfirst"] is True

    @pytest.mark.asyncio
    async def test_main_calls_reset_and_disposes_engine(self, monkeypatch):
        reset_mock = AsyncMock()
        fake_conn = _FakeConnection()
        fake_engine = _FakeEngine(fake_conn)

        monkeypatch.setattr(reset_db_module, "reset_db", reset_mock)
        monkeypatch.setattr(reset_db_module, "engine", fake_engine)

        await reset_db_module.main()

        reset_mock.assert_awaited_once()
        fake_engine.dispose.assert_awaited_once()
