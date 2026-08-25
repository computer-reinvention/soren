from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
import asyncio
import logging
import os
from pathlib import Path

from .config import settings
from .models.agent import Agent, AgentType, AgentRole, AgentStatus

from .routes import (
    webhooks,
    agents,
    messages,
    agent_events,
    journal,
    filesystem,
    sessions,
    thoughts,
    projects,
    teams,
    tasks,
    heartbeat,
    prefs,
    budget,
    memory,
    auth,
    secrets,
    quality,
    terminal,
)
from .services.agent_manager import agent_manager
from .services.agent_registry import agent_registry
from .services.tmux_service import tmux_service
from .websocket.manager import ws_manager
from .services.auth import decode_token, init_db as init_auth_db
from .services.db import init_schema_version, warn_if_migration_needed

logging.basicConfig(level=getattr(logging, settings.log_level))
logger = logging.getLogger(__name__)


def _should_auto_sleep(agent: Agent, threshold_minutes: int) -> bool:
    """Return True if this agent should be auto-slept now.

    Conditions for auto-sleep:
    - Status is IDLE
    - Not a supervisor (any role)
    - keep_awake is False
    - last_activity is set and older than threshold_minutes
    """
    if agent.status != AgentStatus.IDLE:
        return False
    if agent.type == AgentType.SUPERVISOR:
        return False
    if agent.role in (AgentRole.SUPERVISOR, AgentRole.PROJECT_SUPERVISOR):
        return False
    if agent.keep_awake:
        return False
    if agent.last_activity is None:
        return False
    last = agent.last_activity
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - last) >= timedelta(minutes=threshold_minutes)


async def _auto_sleep_task():
    """Background task: put IDLE workers to sleep after idle_sleep_minutes of inactivity."""
    while True:
        await asyncio.sleep(60)
        try:
            agents = await agent_manager.list_agents()
            for agent in agents:
                if not _should_auto_sleep(agent, settings.idle_sleep_minutes):
                    continue
                logger.info(
                    f"Auto-sleeping {agent.id}: IDLE for >{settings.idle_sleep_minutes}min"
                )
                slept = await agent_manager.auto_sleep_agent(agent.id)
                if slept:
                    await ws_manager.broadcast("agent_status", {
                        "agent_id": agent.id,
                        "status": "SLEEPING",
                        "last_activity": (
                            agent.last_activity.isoformat()
                            if agent.last_activity else None
                        ),
                    })
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning(f"Auto-sleep task error: {exc}")


# Paths that bypass authentication entirely
AUTH_EXEMPT_PATHS = {
    "/api/auth/login",
    "/api/auth/logout",
    "/api/webhooks/health",
    "/api/messages/verify-result",
}

# Prefixes that bypass authentication (internal soren-bridge plugin endpoints)
AUTH_EXEMPT_PREFIXES = (
    "/api/agent-events",
    "/api/thoughts",
    "/api/messages/internal",
    "/api/webhooks/",
    "/api/heartbeat",
    "/api/journal",
    "/api/budget",
    "/api/metrics",
    "/api/memory",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Starting soren server...")
    # Consolidated DB (.soren/soren.db): seed schema_version and check whether
    # legacy per-domain DBs still need the one-time ./tools/migrate-state run.
    # Never auto-migrates — explicit operator action; server serves either way.
    init_schema_version()
    warn_if_migration_needed()
    init_auth_db()
    ws_manager.start_ping_task()
    sleep_task = asyncio.create_task(_auto_sleep_task())
    logger.info(f"Auto-sleep task started (idle threshold: {settings.idle_sleep_minutes}min)")
    yield
    # Shutdown
    sleep_task.cancel()
    try:
        await sleep_task
    except asyncio.CancelledError:
        pass
    await ws_manager.stop_ping_task()
    await ws_manager.disconnect_all()
    logger.info("Shutting down soren server...")


app = FastAPI(
    title="soren",
    description="Self-improving multi-agent AI orchestration",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    """Require authentication for all /api/* routes except exempted ones."""
    path = request.url.path

    # Only guard /api/ routes
    if not path.startswith("/api/"):
        return await call_next(request)

    # Exempt specific paths
    if path in AUTH_EXEMPT_PATHS:
        return await call_next(request)

    # Exempt internal hook prefixes
    if any(path.startswith(p) for p in AUTH_EXEMPT_PREFIXES):
        return await call_next(request)

    # NOTE: this branch is dead code for real WebSocket connections —
    # @app.middleware("http") only runs for the "http" ASGI scope and never
    # for "websocket". WS endpoints (/api/agents/ws, /api/terminal/ws)
    # authenticate in-handler via services/ws_auth.authenticate_ws, which is
    # the authoritative check. Kept as defense-in-depth for odd clients that
    # send an Upgrade header over plain HTTP.
    if request.headers.get("upgrade", "").lower() == "websocket":
        token = request.query_params.get("token")
    else:
        # Cookie takes precedence, then Authorization header
        token = request.cookies.get("soren_token")
        if not token:
            auth_header = request.headers.get("Authorization", "")
            if auth_header.startswith("Bearer "):
                token = auth_header[7:]

    if not token or not decode_token(token):
        return JSONResponse(
            status_code=401,
            content={"detail": "Not authenticated"},
        )

    return await call_next(request)


# Routes
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(webhooks.router, prefix="/api/webhooks", tags=["webhooks"])
app.include_router(agents.router, prefix="/api/agents", tags=["agents"])
app.include_router(sessions.router, prefix="/api/sessions", tags=["sessions"])
app.include_router(messages.router, prefix="/api/messages", tags=["messages"])
app.include_router(
    agent_events.router, prefix="/api/agent-events", tags=["agent-events"]
)
app.include_router(journal.router, prefix="/api/journal", tags=["journal"])
app.include_router(filesystem.router, prefix="/api/filesystem", tags=["filesystem"])
app.include_router(thoughts.router, prefix="/api/thoughts", tags=["thoughts"])
app.include_router(projects.router, prefix="/api/projects", tags=["projects"])
app.include_router(teams.router, prefix="/api/teams", tags=["teams"])
app.include_router(tasks.router, prefix="/api/tasks", tags=["tasks"])
app.include_router(heartbeat.router, prefix="/api/heartbeat", tags=["heartbeat"])
app.include_router(prefs.router, prefix="/api/prefs", tags=["prefs"])
app.include_router(budget.router, prefix="/api/budget", tags=["budget"])
app.include_router(memory.router, prefix="/api/memory", tags=["memory"])
app.include_router(secrets.router, prefix="/api/secrets", tags=["secrets"])
app.include_router(quality.router, prefix="/api/metrics", tags=["metrics"])
app.include_router(terminal.router, prefix="/api/terminal", tags=["terminal"])

# Static files (frontend) - only mount if directory exists
frontend_dir = Path("src/frontend/dist")
if frontend_dir.exists():

    class SPAStaticFiles(StaticFiles):
        """Serve the SPA: unknown non-API paths fall back to index.html.

        The dashboard uses client-side routing (react-router). Deep links like
        /agents/supervisor must serve index.html and let the router resolve;
        without this, hard refreshes on any route 404. Starlette raises
        HTTPException(404) for missing files, so we catch — not inspect — it.

        P6.3 (performance audit): also sets Cache-Control. Starlette's
        StaticFiles only sends Last-Modified/ETag by default — every asset
        was getting revalidated (or worse, refetched with no validators at
        all) on every load, a real finding from a Lighthouse trace. Vite
        content-hashes everything under assets/ (a new build always gets a
        new filename), so those are safe to cache for a year as immutable.
        Everything else (index.html, manifest.webmanifest, icons, sw.js)
        keeps a fixed filename and MUST be revalidated every time — an
        aggressively cached index.html would keep serving stale references
        to assets/ files from a previous deploy that may no longer exist.
        """

        async def get_response(self, path: str, scope):  # type: ignore[override]
            is_fallback = False
            try:
                response = await super().get_response(path, scope)
            except StarletteHTTPException as exc:
                if exc.status_code == 404 and not path.startswith("api"):
                    response = await super().get_response("index.html", scope)
                    is_fallback = True
                else:
                    raise
            # A missing assets/*.js path (e.g. a stale reference from an old
            # deploy) falls back to index.html above — it must NOT inherit
            # the immutable cache-control below just because the original
            # requested path started with "assets/".
            if not is_fallback and path.startswith("assets/"):
                response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            else:
                response.headers["Cache-Control"] = "no-cache"
            return response

    app.mount("/", SPAStaticFiles(directory=str(frontend_dir), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=settings.host, port=settings.port)
