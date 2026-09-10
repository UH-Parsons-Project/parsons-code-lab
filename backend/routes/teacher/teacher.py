from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse, HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession

from ...teacher_auth import get_current_user
from ...saml_auth import require_saml
from ... import config
from ...database import get_db
from ..utils.commons import require_session_or_redirect, render_template

# Resolve project base directory (project root)
BASE_DIR = Path(__file__).resolve().parent.parent.parent.parent

router = APIRouter()

async def _render_teacher_page(request: Request, db: AsyncSession, template_name: str):
    redirect = await require_session_or_redirect(get_current_user, "/", request, db)
    if redirect:
        return redirect
    return render_template(template_name, request)


@router.get("/", response_class=HTMLResponse)
async def index(request: Request):
    """Serve the main index page."""
    return render_template("teacher/index.html", request)


@router.get("/internal/saml-test", response_class=HTMLResponse)
async def saml_test_page(request: Request):
    """Serve the unlinked SAML integration test page when SAML is enabled."""
    require_saml()
    if not config.SAML_TEST_PAGE_ENABLED:
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    return render_template("teacher/saml-test.html", request)


@router.get("/teacher-dashboard", response_class=HTMLResponse)
async def teacher_selector(
    request: Request, db: Annotated[AsyncSession, Depends(get_db)]
):
    return await _render_teacher_page(request, db, "teacher/teacher-dashboard.html")


@router.get("/teacher/profile", response_class=HTMLResponse)
async def teacher_profile_page(
    request: Request, db: Annotated[AsyncSession, Depends(get_db)]
):
    return await _render_teacher_page(request, db, "teacher/teacher-profile.html")



@router.get("/teacher-register", response_class=HTMLResponse)
async def teacher_register_page(request: Request):
    """Serve a simple registration page."""
    return render_template("teacher/teacher-register.html", request)


@router.get("/instructions", response_class=HTMLResponse)
async def teacher_instructions_page(request: Request):
    """Serve a simple teacher instructions page."""
    return render_template("teacher/instructions.html", request)


@router.get("/instructions/teacher-content", response_class=HTMLResponse)
async def teacher_instructions_content(
    request: Request, db: Annotated[AsyncSession, Depends(get_db)]
):
    """Serve the teacher-only instructions fragment for authenticated users."""
    return await _render_teacher_page(request, db, "teacher/instructions-teacher-fragment.html")

@router.get("/privacy-policy", response_class=HTMLResponse)
async def privacy_policy_page(request: Request):
    """Serve the privacy policy page."""
    return render_template("common/privacy-policy.html", request)


@router.get("/contact", response_class=HTMLResponse)
async def contact_page(request: Request):
    """Serve the contact page."""
    return render_template("common/contact.html", request)
