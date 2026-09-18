"""
FastAPI backend for Faded Parsons Problems.
Provides endpoints for each page.
"""

from contextlib import asynccontextmanager
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env file
env_path = Path(__file__).parent.parent / '.env'
load_dotenv(env_path)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from .database import init_db, async_session
from . import seed as seed_module
from . import config
from .utils.token_utils import cleanup_old_registration_tokens

from .routes.student.student import router as student_router
from .routes.student.student_api import router as student_api_router
from .routes.admin.admin_api import router as admin_router
from .routes.utils import router as utils_router
from .routes.teacher.teacher import router as teacher_router
from .routes.teacher.teacher_api import router as teacher_api_router
from .routes.task.task import router as task_router
from .routes.task.task_api import router as task_api_router
from .routes.task.initial_events_api import router as initial_events_api_router
from .routes.task.task_set_api import router as task_set_api_router
from .routes.statistic.statistic import router as statistic_router
from .routes.statistic.statistic_api import router as statistic_api_router
from .routes.test.test_api import router as test_router
from .rate_limit import limiter

@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Initialize database and seed data on startup."""
    if config.AUTO_INIT_DB:
        await init_db()
    if config.RUN_SEED_ON_STARTUP:
        await seed_module.seed_db()
    else:
        print("RUN_SEED_ON_STARTUP is false, skipping seed_db() on startup")
    async with async_session() as session:
        await cleanup_old_registration_tokens(session)
        await session.commit()
    yield

app = FastAPI(title="Faded Parsons Problems", lifespan=lifespan)
app.state.limiter = limiter
if config.TEST_MODE:
    limiter.enabled = False
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parent.parent

# Mount static directories (only if they exist)
js_dir = BASE_DIR / "js"
if js_dir.exists():
    app.mount("/js", StaticFiles(directory=js_dir), name="js")

css_dir = BASE_DIR / "css"
if css_dir.exists():
    app.mount("/css", StaticFiles(directory=css_dir), name="css")

js_parsons_dir = BASE_DIR / "js-parsons"
if js_parsons_dir.exists():
    app.mount(
        "/js-parsons", StaticFiles(directory=js_parsons_dir), name="js-parsons"
    )

dist_dir = BASE_DIR / "dist"
if dist_dir.exists():
    app.mount("/dist", StaticFiles(directory=dist_dir), name="dist")

data_dir = BASE_DIR / "data"
if data_dir.exists():
    app.mount("/data", StaticFiles(directory=data_dir), name="data")

documentation_dir = BASE_DIR / "documentation"
if documentation_dir.exists():
    app.mount("/documentation", StaticFiles(directory=documentation_dir), name="documentation")

app.include_router(student_router)

app.include_router(admin_router)
app.include_router(student_api_router)
app.include_router(utils_router)
app.include_router(teacher_api_router)
app.include_router(teacher_router)
app.include_router(task_router)
app.include_router(task_api_router)
app.include_router(task_set_api_router)
app.include_router(initial_events_api_router)
app.include_router(statistic_router)
app.include_router(statistic_api_router)
app.include_router(test_router)

