"""
FastAPI backend for Faded Parsons Problems.
Provides endpoints for each page.
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from .database import init_db
from .seed import seed_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database and seed data on startup."""
    # Note: Tables are also created by schema.sql in Docker. This provides redundancy
    # and ensures tables exist when running outside Docker or if schema.sql changes.
    await init_db()
    await seed_db()
    yield


app = FastAPI(title="Faded Parsons Problems", lifespan=lifespan)

# Get the base directory (parent of backend folder)
BASE_DIR = Path(__file__).resolve().parent.parent


# Mount static directories
app.mount("/js", StaticFiles(directory=BASE_DIR / "js"), name="js")
app.mount("/js-parsons", StaticFiles(directory=BASE_DIR / "js-parsons"), name="js-parsons")
app.mount("/dist", StaticFiles(directory=BASE_DIR / "dist"), name="dist")
app.mount("/data", StaticFiles(directory=BASE_DIR / "data"), name="data")
app.mount("/parsons_probs", StaticFiles(directory=BASE_DIR / "parsons_probs"), name="parsons_probs")
app.mount("/templates", StaticFiles(directory=BASE_DIR / "templates"), name="templates")


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
