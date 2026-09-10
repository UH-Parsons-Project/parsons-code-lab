from typing import Annotated
from datetime import datetime, timedelta, timezone
import secrets

# Third-party
from fastapi import APIRouter, Depends, Response, HTTPException, status, Request
from fastapi.responses import RedirectResponse
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

# Local
from ...models import Teacher, RegistrationToken
from backend.utils import hash_token, cleanup_old_registration_tokens
from ...database import get_db
from ...teacher_auth import authenticate_user, ACCESS_TOKEN_EXPIRE_MINUTES, create_access_token, CurrentUser
from ... import config
from ...pydantic import Token, UserInfo, TeacherLookupResponse
from ..utils.commons import validate_registration_basic, ensure_unique_user
from ...rate_limit import limiter, check_brute_force, record_failed_attempt, clear_failed_attempts
from ...saml_auth import require_saml, shibboleth_identity, shibboleth_login_url

router = APIRouter()


@router.get("/auth/saml/login")
async def saml_login(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    require_saml()
    identity = shibboleth_identity(request)
    if identity is None:
        return RedirectResponse(shibboleth_login_url())
    email, username = identity

    result = await db.execute(select(Teacher).where(Teacher.email.ilike(email)))
    user = result.scalar_one_or_none()
    if user is None:
        user = Teacher(username=username[:100], email=email)
        user.set_password(secrets.token_urlsafe(32))
        db.add(user)
        await db.commit()
        await db.refresh(user)
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Inactive user")

    access_token = create_access_token(data={"sub": user.username}, expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    response = RedirectResponse(url="/teacher-dashboard", status_code=status.HTTP_303_SEE_OTHER)
    response.set_cookie(key="access_token", value=access_token, httponly=True,
                        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60, path="/",
                        samesite="lax", secure=config.COOKIE_SECURE)
    return response


@router.post("/api/login/access-token", response_model=Token)
@limiter.limit("20/minute")
async def login_access_token(
    request: Request,
    response: Response,
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    identifier = form_data.username.strip().lower()

    remaining = check_brute_force(identifier)
    if remaining is not None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Account temporarily locked. Try again in {int(remaining // 60) + 1} minute(s).",
        )

    user = await authenticate_user(form_data.username, form_data.password, db)

    if not user:
        record_failed_attempt(identifier)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect username, email, or password",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Inactive user"
        )

    clear_failed_attempts(identifier)

    user.updated_at = datetime.now(timezone.utc)
    await db.commit()

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires
    )

    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        path="/",
        samesite="lax",
        secure=config.COOKIE_SECURE,
    )

    return Token(access_token=access_token, token_type="bearer")


@router.get("/api/me", response_model=UserInfo)
async def get_current_user_info(current_user: CurrentUser):
    role = "Admin" if current_user.is_admin_teacher else "Teacher"
    return UserInfo(
        id=current_user.id,
        username=current_user.username,
        email=current_user.email,
        is_admin_teacher=current_user.is_admin_teacher,
        role=role,
    )


@router.post("/api/logout")
async def logout(response: Response):
    response.delete_cookie(key="access_token", path="/")
    return {"message": "Successfully logged out"}


@router.post("/api/teacher_register")
async def api_teacher_register(
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Register a new teacher with username, password and email."""
    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid JSON payload",
        ) from exc

    username = str(payload.get("username", "")).strip()
    password = payload.get("password", "")
    password_confirm = payload.get("password_confirm", "")
    email = str(payload.get("email", "")).strip()
    registration_token = str(payload.get("registration_token", "")).strip()

    reg_identifier = f"reg:{request.client.host}"

    remaining = check_brute_force(reg_identifier)
    if remaining is not None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many failed attempts. Try again in {int(remaining // 60) + 1} minute(s).",
        )

    await cleanup_old_registration_tokens(db)
    await db.commit()

    # Validate registration token from database
    if not registration_token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Registration token is required",
        )

    # Find matching token in database by hash (O(1) lookup)
    token_hash = hash_token(registration_token)
    stmt = select(RegistrationToken).where(RegistrationToken.token_hash == token_hash)
    result = await db.execute(stmt)
    valid_token = result.scalar_one_or_none()

    if not valid_token:
        record_failed_attempt(reg_identifier)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid registration token",
        )

    if valid_token.is_expired():
        record_failed_attempt(reg_identifier)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Registration token has expired",
        )

    # Basic validation (lengths, presence, password match)
    validate_registration_basic(username, password, password_confirm, email,
                                username_max=50, email_max=100)

    # Ensure uniqueness in DB
    await ensure_unique_user(db, Teacher, username, email)

    teacher = Teacher(username=username, email=email)
    teacher.set_password(password)

    db.add(teacher)
    await db.commit()
    await db.refresh(teacher)

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": teacher.username}, expires_delta=access_token_expires
    )

    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        path="/",
        samesite="lax",
        secure=config.COOKIE_SECURE,
    )

    clear_failed_attempts(reg_identifier)
    return {
        "status": "success",
        "id": teacher.id,
        "username": teacher.username,
        "access_token": access_token,
        "token_type": "bearer",
    }


@router.get("/api/teacher/profile")
async def get_teacher_profile(
    current_user: CurrentUser,
):
    return {
        "username": current_user.username,
        "email": current_user.email,
        "created_at": current_user.created_at.isoformat() if current_user.created_at else "",
    }


@router.post("/api/teacher/profile/email")
async def update_teacher_email(
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    body = await request.json()
    new_email = body.get("email", "").strip()
    password = body.get("password", "")

    if not new_email or not password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email and password are required")

    if not current_user.verify_password(password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Incorrect password")

    if len(new_email) > 100:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email too long")

    import re
    EMAIL_REGEX = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
    if not re.match(EMAIL_REGEX, new_email):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid email format")

    # Check email uniqueness against other teachers
    email_stmt = select(Teacher).where(Teacher.email == new_email, Teacher.id != current_user.id)
    email_result = await db.execute(email_stmt)
    if email_result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email is already in use")

    current_user.email = new_email
    await db.commit()
    return {"status": "success", "message": "Email updated successfully"}


@router.post("/api/teacher/profile/password")
async def update_teacher_password(
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    body = await request.json()
    current_password = body.get("current_password", "")
    new_password = body.get("new_password", "")
    new_password_confirm = body.get("new_password_confirm", "")

    if not current_password or not new_password or not new_password_confirm:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="All password fields are required")

    if not current_user.verify_password(current_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Incorrect current password")

    if new_password != new_password_confirm:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="New passwords do not match")

    if current_password == new_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="New password cannot be the same as the current password")

    if len(new_password) < 8:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password must have a minimum length of 8 characters")

    current_user.set_password(new_password)
    await db.commit()
    return {"status": "success", "message": "Password updated successfully"}


@router.get("/api/teachers/lookup", response_model=TeacherLookupResponse)
async def lookup_teacher(
    identifier: str,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)]
):
    identifier = identifier.strip()
    if not identifier:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="identifier is required")

    result = await db.execute(
        select(Teacher).where(
            (Teacher.username == identifier) | (Teacher.email == identifier)
        )
    )
    teacher = result.scalar_one_or_none()

    if not teacher or not teacher.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Teacher not found")

    return TeacherLookupResponse(
        teacher_id=teacher.id,
        username=teacher.username,
        email=teacher.email,
    )
