"""Unit tests for the optional Redis cache helpers."""

import json

import pytest
from redis.exceptions import RedisError

from backend import cache


class FakeRedis:
    def __init__(self):
        self.values = {}
        self.deleted_keys = []
        self.fail = False

    async def get(self, key):
        if self.fail:
            raise RedisError("Redis unavailable")
        return self.values.get(key)

    async def set(self, key, value, ex):
        if self.fail:
            raise RedisError("Redis unavailable")
        self.values[key] = value

    async def delete(self, *keys):
        if self.fail:
            raise RedisError("Redis unavailable")
        self.deleted_keys.extend(keys)
        for key in keys:
            self.values.pop(key, None)


@pytest.fixture
def fake_redis(monkeypatch):
    client = FakeRedis()
    monkeypatch.setattr(cache, "redis", client)
    return client


async def test_get_json_returns_cached_value(fake_redis):
    fake_redis.values["example"] = json.dumps({"value": 42})

    assert await cache.get_json("example") == {"value": 42}


async def test_get_json_returns_none_on_cache_miss(fake_redis):
    assert await cache.get_json("missing") is None


async def test_set_json_serializes_value_with_ttl(fake_redis):
    await cache.set_json("example", {"value": 42}, ttl_seconds=15)

    assert json.loads(fake_redis.values["example"]) == {"value": 42}


async def test_invalidate_task_statistics_removes_public_and_task_set_keys(fake_redis):
    public_key = "stats:task:7:set:public:v1"
    task_set_key = "stats:task:7:set:12:v1"
    aggregate_key = "stats:taskset:aggregate:12:v1"
    student_key = "stats:student:4:task:7:set:12:v1"
    fake_redis.values[public_key] = "public"
    fake_redis.values[task_set_key] = "task-set"
    fake_redis.values[aggregate_key] = "aggregate"
    fake_redis.values[student_key] = "student"

    await cache.invalidate_task_statistics(7, 12, 4)

    assert public_key not in fake_redis.values
    assert task_set_key not in fake_redis.values
    assert aggregate_key not in fake_redis.values
    assert student_key not in fake_redis.values
    assert fake_redis.deleted_keys == [public_key, aggregate_key, task_set_key, student_key]


async def test_cache_helpers_fail_open_when_redis_is_unavailable(fake_redis):
    fake_redis.fail = True

    assert await cache.get_json("example") is None
    await cache.set_json("example", {"value": 42})
    await cache.invalidate_task_statistics(7, 12)
