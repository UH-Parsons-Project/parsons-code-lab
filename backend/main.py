"""
FastAPI backend for Faded Parsons Problems.
Provides endpoints for each page.
"""

from contextlib import asynccontextmanager
from datetime import timedelta
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from .database import init_db, get_db
from .seed import seed_db
from .auth import authenticate_user, create_access_token, get_current_user, ACCESS_TOKEN_EXPIRE_MINUTES
from .models import Teacher


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database and seed data on startup."""
    # Note: Tables are also created by schema.sql in Docker. This provides redundancy
    # and ensures tables exist when running outside Docker or if schema.sql changes.
    await init_db()
    await seed_db()
    yield


app = FastAPI(title="Faded Parsons Problems", lifespan=lifespan)

# CORS middleware for development (restrict in production)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Change to specific origins in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Get the base directory (parent of backend folder)
BASE_DIR = Path(__file__).resolve().parent.parent


# Pydantic models for request/response
class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str
    username: str


class UserInfo(BaseModel):
    username: str
    email: str


# Mount static directories
app.mount("/js", StaticFiles(directory=BASE_DIR / "js"), name="js")
app.mount("/js-parsons", StaticFiles(directory=BASE_DIR / "js-parsons"), name="js-parsons")
app.mount("/dist", StaticFiles(directory=BASE_DIR / "dist"), name="dist")
app.mount("/data", StaticFiles(directory=BASE_DIR / "data"), name="data")
app.mount("/parsons_probs", StaticFiles(directory=BASE_DIR / "parsons_probs"), name="parsons_probs")


@app.get("/", response_class=HTMLResponse)
async def index():
    """Serve the main index page."""
    index_path = BASE_DIR / "index.html"
    return FileResponse(index_path)


@app.get("/index.html", response_class=HTMLResponse)
async def index_html():
    """Serve the main index page (explicit path)."""
    index_path = BASE_DIR / "index.html"
    return FileResponse(index_path)


@app.get("/problem.html", response_class=HTMLResponse)
async def problem_page():
    """Serve the problem page."""
    problem_path = BASE_DIR / "problem.html"
    return FileResponse(problem_path)


@app.get("/exerciselist", response_class=HTMLResponse)
async def exercise_list():
    """Serve the exercise list page."""
    exerciselist_path = BASE_DIR / "templates" / "exerciselist.html"
    return FileResponse(exerciselist_path)


# Authentication endpoints
@app.post("/api/login", response_model=LoginResponse)
async def login(
    login_data: LoginRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Authenticate user and return JWT token.
    """
    user = await authenticate_user(login_data.username, login_data.password, db)
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Create access token
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires
    )
    
    return LoginResponse(
        access_token=access_token,
        token_type="bearer",
        username=user.username
    )


@app.get("/api/me", response_model=UserInfo)
async def get_current_user_info(current_user: Teacher = Depends(get_current_user)):
    """
    Get current authenticated user information.
    """
    return UserInfo(
        username=current_user.username,
        email=current_user.email
    )
