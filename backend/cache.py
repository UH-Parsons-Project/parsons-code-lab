"""Shared Redis client for optional application caches."""

import json
from typing import Any

from redis.asyncio import Redis
from redis.exceptions import RedisError

from .config import REDIS_URL


redis: Redis | None = Redis.from_url(REDIS_URL, decode_responses=True) if REDIS_URL else None


async def get_json(key: str) -> Any | None:
    """Return a cached JSON value, or None when caching is disabled or empty."""
    if redis is None:
        return None

    try:
        value = await redis.get(key)
        return json.loads(value) if value is not None else None
    except (RedisError, json.JSONDecodeError):
        return None


async def set_json(key: str, value: Any, ttl_seconds: int = 30) -> None:
    """Store a JSON value with a short expiry."""
    if redis is not None:
        try:
            await redis.set(key, json.dumps(value), ex=ttl_seconds)
        except (RedisError, TypeError, ValueError):
            pass


async def invalidate_task_statistics(
    task_id: int,
    task_set_id: int | None = None,
    student_id: int | None = None,
) -> None:
    """Remove cached statistics affected by a task data change."""
    if redis is None:
        return

    keys = [
        f"stats:task:{task_id}:set:public:v1",
        f"stats:taskset:aggregate:{task_set_id}:v1" if task_set_id is not None else None,
    ]
    if task_set_id is not None:
        keys.append(f"stats:task:{task_id}:set:{task_set_id}:v1")
    if student_id is not None and task_set_id is not None:
        keys.append(f"stats:student:{student_id}:task:{task_id}:set:{task_set_id}:v1")

    try:
        await redis.delete(*(key for key in keys if key is not None))
    except RedisError:
        pass


async def close() -> None:
    """Close the shared Redis connection when the application shuts down."""
    if redis is not None:
        await redis.aclose()