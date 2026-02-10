"""
Authentication utilities for JWT token management.
"""

import os
from datetime import datetime, timedelta
from typing import Optional, Annotated
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .database import get_db
from .models import Teacher

# Security configuration
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-in-production-please")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 480  # 8 hours

security = HTTPBearer()


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create a JWT access token."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db)
) -> Teacher:
    """
    Dependency to get the current authenticated user from JWT token.
    Checks cookies first (for browser navigation), then Authorization header (for API calls).
    Raises HTTPException if token is invalid or user not found.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    # Try to get token from cookie first (for browser page navigation)
    token = request.cookies.get("access_token")
    
    # Fallback to Authorization header (for API calls)
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]
    
    if not token:
        raise credentials_exception
    
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    
    # Fetch user from database
    result = await db.execute(
        select(Teacher).where(Teacher.username == username)
    )
    user = result.scalar_one_or_none()
    
    if user is None or not user.is_active:
        raise credentials_exception
    
    return user


async def authenticate_user(username: str, password: str, db: AsyncSession) -> Optional[Teacher]:
    """
    Authenticate a user by username and password.
    Returns the Teacher object if valid, None otherwise.
    """
    result = await db.execute(
        select(Teacher).where(Teacher.username == username)
    )
    user = result.scalar_one_or_none()
    
    if not user or not user.is_active:
        return None
    
    if not user.verify_password(password):
        return None
    
    return user


# Type alias for current user dependency (FastAPI template style)
CurrentUser = Annotated[Teacher, Depends(get_current_user)]
