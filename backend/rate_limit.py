"""Rate limiting: IP-based (slowapi) and per-username brute-force lockout."""

import time
from slowapi import Limiter
from slowapi.util import get_remote_address

from backend import config

# Website wide limiter, prevents DDOS attacks and other bots. When spamming
# it ignores all requests above 200 per minute. Disables in TEST_MODE.
limiter = Limiter(key_func=get_remote_address, default_limits=["200/minute"], enabled=not config.TEST_MODE)

# {identifier: {"attempts": int, "locked_until": float}}
_failed_attempts: dict[str, dict] = {}

MAX_ATTEMPTS = 10
LOCKOUT_SECONDS = 5 * 60  # 5 minutes


def check_brute_force(identifier: str) -> float | None:
    """Return remaining lockout seconds if locked, else None."""
    if config.TEST_MODE:
        return None
    entry = _failed_attempts.get(identifier)
    if not entry:
        return None
    locked_until = entry.get("locked_until", 0)
    if locked_until and time.monotonic() < locked_until:
        return locked_until - time.monotonic()
    return None


def record_failed_attempt(identifier: str) -> int:
    """Record a failed attempt. Returns attempts remaining before lockout."""
    if config.TEST_MODE:
        return MAX_ATTEMPTS
    entry = _failed_attempts.setdefault(identifier, {"attempts": 0, "locked_until": 0})
    # Reset if previous lockout has expired
    if entry["locked_until"] and time.monotonic() >= entry["locked_until"]:
        entry["attempts"] = 0
        entry["locked_until"] = 0
    entry["attempts"] += 1
    if entry["attempts"] >= MAX_ATTEMPTS:
        entry["locked_until"] = time.monotonic() + LOCKOUT_SECONDS
    return max(0, MAX_ATTEMPTS - entry["attempts"])


def clear_failed_attempts(identifier: str) -> None:
    _failed_attempts.pop(identifier, None)

