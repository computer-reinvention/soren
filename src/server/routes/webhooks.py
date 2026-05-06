from fastapi import APIRouter, BackgroundTasks, Request
from fastapi.responses import JSONResponse
from datetime import datetime, timezone
from pathlib import Path
import json
import logging
import os
import sqlite3
import subprocess
import time
import uuid

from ..config import settings
from ..models.webhook import WebhookPayload, WebhookResponse
from ..services.agent_registry import agent_registry
from ..services import budget_guard
from ..services.mailbox import mailbox_service
from ..websocket.manager import ws_manager

logger = logging.getLogger(__name__)

_SERVER_START_TIME = time.time()

router = APIRouter()


@router.post("/{source}", response_model=WebhookResponse)
async def receive_webhook(
    source: str,
    payload: WebhookPayload,
    background_tasks: BackgroundTasks
):
    """Receive and process webhook from external source."""
    message_id = str(uuid.uuid4())

    # Queue message for supervisor
    await mailbox_service.send_to_supervisor(
        message_id=message_id,
        source=source,
        payload=payload.model_dump()
    )

    # Broadcast to dashboard
    background_tasks.add_task(
        ws_manager.broadcast,
        "webhook_received",
        {"source": source, "message_id": message_id}
    )

    return WebhookResponse(
        success=True,
        message_id=message_id,
        queued_at=datetime.now(timezone.utc)
    )


@router.get("/health")
async def webhook_health():
    """Health check with frontend status. Returns 503 if degraded."""
    frontend_dist = Path("src/frontend/dist")
    index_exists = (frontend_dist / "index.html").exists()

    assets_dir = frontend_dist / "assets"
    js_files = list(assets_dir.glob("*.js")) if assets_dir.exists() else []
    frontend_ok = index_exists and len(js_files) > 0

    # Check daemon PID files
    pid_files = {
        "monitor": settings.soren_dir / "run" / "monitor.pid",
        "router": settings.soren_dir / "run" / "router.pid",
        "compact": settings.soren_dir / "run" / "compact.pid",
        "server": settings.soren_dir / "server.pid",
    }
    daemon_status = {}
    alive_count = 0
    for name, pid_path in pid_files.items():
        alive = False
        if pid_path.exists():
            try:
                pid = int(pid_path.read_text().strip())
                os.kill(pid, 0)
                alive = True
            except (ValueError, ProcessLookupError, PermissionError, OSError):
                pass
        daemon_status[name] = alive
        if alive:
            alive_count += 1

    # Check for duplicate monitor processes
    monitor_duplicates = 0
    try:
        result = subprocess.run(
            ["pgrep", "-af", "monitor.sh"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            monitor_duplicates = sum(
                1 for line in result.stdout.strip().splitlines()
                if "bash" in line and "monitor.sh" in line and "pgrep" not in line
            )
    except (subprocess.TimeoutExpired, ValueError):
        pass

    daemons_info: dict = {
        **daemon_status,
        "count": alive_count,
        "expected": len(pid_files),
    }
    if monitor_duplicates > 1:
        daemons_info["monitor_duplicates"] = monitor_duplicates

    response_data = {
        "api": "healthy",
        "frontend": {
            "status": "healthy" if frontend_ok else "unhealthy",
            "index_exists": index_exists,
            "js_bundle_count": len(js_files)
        },
        "daemons": daemons_info,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

    if not frontend_ok:
        response_data["status"] = "degraded"
        return JSONResponse(response_data, status_code=503)

    if alive_count < len(pid_files):
        missing = [n for n, v in daemon_status.items() if not v]
        response_data["warning"] = f"daemons down: {', '.join(missing)}"

    response_data["status"] = "healthy"
    return response_data


@router.get("/scorecard")
async def health_scorecard():
    """System health scorecard with key operational metrics."""
    uptime_seconds = int(time.time() - _SERVER_START_TIME)

    # Tasks completed today
    tasks_completed_today = 0
    tasks_db = settings.soren_dir / "tasks.db"
    if tasks_db.exists():
        try:
            conn = sqlite3.connect(str(tasks_db))
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA busy_timeout=5000")
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            row = conn.execute(
                "SELECT COUNT(*) FROM tasks WHERE status IN ('done','verified') "
                "AND completed_at LIKE ?",
                (f"{today}%",),
            ).fetchone()
            tasks_completed_today = row[0] if row else 0
            conn.close()
        except Exception:
            pass

    # Budget usage
    budget_status = budget_guard.get_budget_status()
    budget_usage_pct = budget_status.get("percentage_used", 0) * 100

    # Agent counts
    all_agents = agent_registry.get_all_entries()
    agents_active = sum(
        1 for a in all_agents.values()
        if a.get("status") in ("IN_PROGRESS", "IDLE", "PENDING", "TESTING")
    )
    agents_sleeping = sum(
        1 for a in all_agents.values()
        if a.get("status") == "SLEEPING"
    )

    return {
        "uptime_seconds": uptime_seconds,
        "tasks_completed_today": tasks_completed_today,
        "budget_usage_pct": round(budget_usage_pct, 1),
        "agents_active": agents_active,
        "agents_sleeping": agents_sleeping,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
