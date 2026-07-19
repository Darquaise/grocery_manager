import asyncio
import re
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session, SQLModel
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.sessions import SessionMiddleware
from starlette.types import Scope

from .api import auth, invites, kitchens, legal, products, shopping, users
from .api.named_lists import categories_router, locations_router
from .config import settings
from .db import engine
from .events import bus
from .seed import seed

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # In production Alembic owns the schema (the container runs `alembic upgrade
    # head` before uvicorn); for local dev create_all is a convenience. Seeding
    # (the two accounts) is idempotent and always runs.
    bus.attach_loop(asyncio.get_running_loop())
    if settings.db_auto_create:
        SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        seed(session)
    yield


app = FastAPI(title="Grocery Manager", lifespan=lifespan)
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.session_secret,
    same_site="lax",
    https_only=False,  # app sits behind a TLS-terminating nginx (sees http)
)

_KITCHEN_PATH = re.compile(r"^/api/kitchens/(\d+)(?:/|$)")
_MUTATING = {"POST", "PATCH", "PUT", "DELETE"}


@app.middleware("http")
async def kitchen_change_events(request: Request, call_next):
    """Bump the kitchen's live-update revision after every successful mutation
    under /api/kitchens/{id}/… — new endpoints are covered automatically.
    Mutations whose URL carries no kitchen id (invite accept, colour change)
    bump explicitly at their endpoint instead."""
    response = await call_next(request)
    if request.method in _MUTATING and response.status_code < 400:
        match = _KITCHEN_PATH.match(request.url.path)
        if match:
            bus.bump(int(match.group(1)))
    return response


app.include_router(auth.router, prefix="/api")
app.include_router(invites.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(kitchens.router, prefix="/api")
app.include_router(kitchens.my_invites_router, prefix="/api")
app.include_router(categories_router, prefix="/api")
app.include_router(locations_router, prefix="/api")
app.include_router(products.router, prefix="/api")
app.include_router(shopping.router, prefix="/api")
app.include_router(legal.router, prefix="/api")


@app.get("/api/health")
def health():
    return {"status": "ok"}


class SPAStaticFiles(StaticFiles):
    """Serve the built Angular app, falling back to index.html for client-side
    routes (deep links / refresh)."""

    async def get_response(self, path: str, scope: Scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code == 404:
                return await super().get_response("index.html", scope)
            raise


# Mounted last so /api/* always wins. Skipped in dev until the SPA is built.
if STATIC_DIR.is_dir():
    app.mount("/", SPAStaticFiles(directory=STATIC_DIR, html=True), name="spa")
