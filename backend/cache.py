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


async def close() -> None:
    """Close the shared Redis connection when the application shuts down."""
    if redis is not None:
        await redis.aclose()