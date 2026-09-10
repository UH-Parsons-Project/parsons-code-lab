"""Authentication utilities for JWT token management."""

import os
from datetime import datetime, timedelta, timezone
from typing import Optional, Annotated
from fastapi import Depends, HTTPException, status, Request
import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .database import get_db
from .models import Teacher

# Security configuration — must be set in the environment; fail fast if missing.
_secret_key = os.getenv("SECRET_KEY")
if not _secret_key:
    raise RuntimeError(
        "SECRET_KEY environment variable is not set. "
        "Generate one with: python -c \"import secrets; print(secrets.token_hex(64))\""
    )
SECRET_KEY: str = _secret_key
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 480  # 8 hours


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create a JWT access token."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def _get_token_from_request(request: Request) -> str | None:
    """Extract token from cookie or Authorization header."""
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]
    return token


async def _get_user_from_token(token: str, db: AsyncSession) -> Teacher:
    """Decode JWT token and fetch user from DB."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except jwt.InvalidTokenError as exc:
        raise credentials_exception from exc

    result = await db.execute(select(Teacher).where(Teacher.username == username))
    user = result.scalar_one_or_none()

    if user is None or not user.is_active:
        raise credentials_exception

    return user


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> Teacher:
    """Dependency to get the current authenticated user from JWT token.

    Checks cookies first (for browser navigation), then Authorization header (for API calls).
    Raises HTTPException if token is invalid or user not found.
    """
    token = _get_token_from_request(request)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return await _get_user_from_token(token, db)


async def get_current_user_optional(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> Teacher | None:
    """Return the current user if a token is provided, otherwise None."""
    token = _get_token_from_request(request)
    if not token:
        return None

    return await _get_user_from_token(token, db)


async def authenticate_user(username_or_email: str, password: str, db: AsyncSession) -> Optional[Teacher]:
    """Authenticate a teacher by username or email and password.

    Returns the Teacher object if valid, None otherwise.
    """
    login_value = username_or_email.strip()

    result = await db.execute(select(Teacher).where(Teacher.username == login_value))
    user = result.scalar_one_or_none()

    if not user:
        result = await db.execute(
            select(Teacher).where(Teacher.email.ilike(login_value))
        )
        user = result.scalar_one_or_none()

    if not user or not user.is_active:
        return None

    if not user.verify_password(password):
        return None

    return user


# Type alias for current user dependency (FastAPI template style)
CurrentUser = Annotated[Teacher, Depends(get_current_user)]
OptionalCurrentUser = Annotated[Teacher | None, Depends(get_current_user_optional)]
