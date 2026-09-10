from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from ...teacher_auth import get_current_user
from ...database import get_db
from .admin_api import BASE_DIR, router


from ..utils.commons import render_template


async def _serve_admin_page(request: Request, db: AsyncSession, template_name: str):
	try:
		current_user = await get_current_user(request, db)
		if not current_user.is_admin_teacher:
			raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)
	except HTTPException:
		return RedirectResponse(url="/", status_code=status.HTTP_303_SEE_OTHER)

	return render_template(template_name, request)


@router.get("/all-tasksets", response_class=HTMLResponse)
async def all_tasksets_page(request: Request, db: Annotated[AsyncSession, Depends(get_db)]):
	"""Serve the page for viewing all task sets (requires data access)."""
	return await _serve_admin_page(request, db, "admin/all-tasksets.html")


@router.get("/admin-dashboard", response_class=HTMLResponse)
async def admin_dashboard_page(request: Request, db: Annotated[AsyncSession, Depends(get_db)]):
	"""Serve the admin dashboard page (requires admin access)."""
	return await _serve_admin_page(request, db, "admin/admin-dashboard.html")


@router.get("/all-users", response_class=HTMLResponse)
async def all_users_page(request: Request, db: Annotated[AsyncSession, Depends(get_db)]):
	"""Serve the page for viewing all users (requires admin access)."""
	return await _serve_admin_page(request, db, "admin/all-users.html")


@router.get("/admin/admins-teacher-view", response_class=HTMLResponse)
async def admins_teacher_view_page(request: Request, db: Annotated[AsyncSession, Depends(get_db)]):
	"""Serve the page for viewing a specific teacher's sets and tasks (requires admin access)."""
	return await _serve_admin_page(request, db, "admin/admins-teacher-view.html")


@router.get("/admin/admins-student-view", response_class=HTMLResponse)
async def admins_student_view_page(request: Request, db: Annotated[AsyncSession, Depends(get_db)]):
	"""Serve the page for viewing a specific student's sets and tasks (requires admin access)."""
	return await _serve_admin_page(request, db, "admin/admins-student-view.html")
