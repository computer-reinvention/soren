from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from datetime import datetime, timezone
from pathlib import Path
import json
import logging
import os
import re
import subprocess
import time
import uuid

from ..config import settings
from ..models.webhook import WebhookPayload, WebhookResponse
from ..services import db
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
    try:
        conn = db.connect()
        try:
            if db.table_exists(conn, "tasks"):
                today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
                row = conn.execute(
                    "SELECT COUNT(*) FROM tasks WHERE status IN ('done','verified') "
                    "AND completed_at LIKE ?",
                    (f"{today}%",),
                ).fetchone()
                tasks_completed_today = row[0] if row else 0
        finally:
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

    # Git branch and commit info
    git_branch = "unknown"
    git_sha = "unknown"
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            git_branch = result.stdout.strip()
        result2 = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, timeout=5,
        )
        if result2.returncode == 0:
            git_sha = result2.stdout.strip()
    except Exception:
        pass

    return {
        "uptime_seconds": uptime_seconds,
        "tasks_completed_today": tasks_completed_today,
        "budget_usage_pct": round(budget_usage_pct, 1),
        "agents_active": agents_active,
        "agents_sleeping": agents_sleeping,
        "git_branch": git_branch,
        "git_sha": git_sha,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


_GIT_STATUS_CODES = {
    "M": "modified", "A": "added", "D": "deleted", "R": "renamed",
    "C": "copied", "U": "unmerged", "?": "untracked", "!": "ignored",
}


def _run_git(args: list[str], timeout: float = 5) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args], capture_output=True, text=True, timeout=timeout,
    )


def _run_git_bytes(args: list[str], timeout: float = 5) -> subprocess.CompletedProcess:
    """Like _run_git but without text=True — for `git show <ref>:<path>`,
    where the blob can be arbitrary binary content (e.g. a PNG). subprocess
    with text=True decodes stdout as UTF-8 unconditionally and raises
    UnicodeDecodeError on the first non-UTF-8 byte, which crashes the whole
    request before _blob_at's own binary-detection check ever runs — this
    was a real bug caught when the diff endpoint was exercised against a
    commit that added actual binary assets (PWA icons) for the first time.
    """
    return subprocess.run(["git", *args], capture_output=True, timeout=timeout)


@router.get("/git-status")
async def git_status():
    """Working-tree status for the git status panel (P3.3).

    Read-only; every git call is individually guarded so a missing repo,
    detached HEAD, or no-upstream branch degrades to defaults instead of
    a 500. Collections are capped — this is a dashboard summary, not a
    full `git log`/`git status` dump.
    """
    branch = "unknown"
    sha = "unknown"
    ahead = 0
    behind = 0
    has_upstream = False
    changed_files: list[dict] = []
    recent_commits: list[dict] = []

    try:
        r = _run_git(["rev-parse", "--abbrev-ref", "HEAD"])
        if r.returncode == 0:
            branch = r.stdout.strip()
    except Exception:
        pass

    try:
        r = _run_git(["rev-parse", "--short", "HEAD"])
        if r.returncode == 0:
            sha = r.stdout.strip()
    except Exception:
        pass

    try:
        r = _run_git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
        has_upstream = r.returncode == 0
        if has_upstream:
            counts = _run_git(["rev-list", "--left-right", "--count", "HEAD...@{u}"])
            if counts.returncode == 0:
                parts = counts.stdout.split()
                if len(parts) == 2:
                    ahead, behind = int(parts[0]), int(parts[1])
    except Exception:
        pass

    try:
        r = _run_git(["status", "--porcelain=v1"])
        if r.returncode == 0:
            lines = [ln for ln in r.stdout.splitlines() if ln]
            for line in lines[:50]:
                code = line[:2].strip() or "?"
                path = line[3:]
                changed_files.append({
                    "path": path,
                    "status": _GIT_STATUS_CODES.get(code[0], code),
                })
    except Exception:
        pass

    try:
        r = _run_git(["log", "-15", "--pretty=format:%h\x1f%an\x1f%ad\x1f%s", "--date=iso-strict"])
        if r.returncode == 0:
            for line in r.stdout.splitlines():
                parts = line.split("\x1f", 3)
                if len(parts) == 4:
                    recent_commits.append({
                        "sha": parts[0], "author": parts[1],
                        "date": parts[2], "message": parts[3],
                    })
    except Exception:
        pass

    return {
        "branch": branch,
        "sha": sha,
        "ahead": ahead,
        "behind": behind,
        "has_upstream": has_upstream,
        "uncommitted_count": len(changed_files),
        "changed_files": changed_files,
        "recent_commits": recent_commits,
    }


_SAFE_REF = re.compile(r"^[A-Za-z0-9._/-]{1,64}$")
_MAX_DIFF_FILES = 20
_MAX_DIFF_FILE_BYTES = 300_000


def _safe_ref(ref: str) -> bool:
    """Reject anything that isn't a plain git ref — no flags, no shell metachars.

    `git show <sha>` treats a leading '-' as an option, so validating shape
    (not just "is this a string") matters even though subprocess.run's list
    form already rules out shell injection.
    """
    return bool(_SAFE_REF.match(ref)) and not ref.startswith("-")


def _blob_at(ref: str, path: str) -> tuple[str, bool]:
    """Read a file's content at a git ref. Returns (content, is_binary)."""
    r = _run_git_bytes(["show", f"{ref}:{path}"])
    if r.returncode != 0:
        return "", False  # file didn't exist at this ref (added/deleted)
    if b"\x00" in r.stdout[:8192]:
        return "", True
    return r.stdout[:_MAX_DIFF_FILE_BYTES].decode("utf-8", errors="replace"), False


@router.get("/commit-diff")
async def commit_diff(sha: str = Query(..., description="Commit sha, or 'working' for uncommitted changes")):
    """Per-file before/after content for the diff viewer (P3.2).

    `sha='working'` diffs the working tree against HEAD (covers uncommitted
    changes already surfaced by /git-status); any other value is a real
    commit, diffed against its first parent. Capped at 20 files / 300KB per
    file — this feeds a browser diff view, not a patch export.
    """
    if sha != "working" and not _safe_ref(sha):
        raise HTTPException(status_code=422, detail="Invalid ref")

    if sha == "working":
        name_status = _run_git(["diff", "--name-status", "HEAD"])
        base_ref = "HEAD"
        head_ref = None  # read from working tree
        title = "Working tree changes"
    else:
        name_status = _run_git(["show", "--name-status", "--format=", sha])
        base_ref = f"{sha}~1"
        head_ref = sha
        show_meta = _run_git(["show", "-s", "--format=%h\x1f%an\x1f%ad\x1f%s", "--date=iso-strict", sha])
        if show_meta.returncode != 0:
            raise HTTPException(status_code=404, detail=f"Unknown commit: {sha}")
        title = show_meta.stdout.strip()

    if name_status.returncode != 0:
        raise HTTPException(status_code=404, detail=f"Unknown ref: {sha}")

    entries = [ln for ln in name_status.stdout.splitlines() if ln.strip()][:_MAX_DIFF_FILES]
    files = []
    for line in entries:
        parts = line.split("\t")
        status_code, path = parts[0], parts[-1]
        status = _GIT_STATUS_CODES.get(status_code[0], status_code)

        old_content, old_binary = ("", False) if status == "added" else _blob_at(base_ref, path)

        if head_ref is None:
            try:
                file_path = Path(path)
                new_binary = b"\x00" in file_path.read_bytes()[:8192] if file_path.exists() else False
                new_content = "" if new_binary or not file_path.exists() else file_path.read_text(errors="replace")[:_MAX_DIFF_FILE_BYTES]
            except Exception:
                new_content, new_binary = "", False
        else:
            new_content, new_binary = ("", False) if status == "deleted" else _blob_at(head_ref, path)

        files.append({
            "path": path,
            "status": status,
            "binary": old_binary or new_binary,
            "old_content": old_content,
            "new_content": new_content,
        })

    return {"sha": sha, "title": title, "files": files, "truncated": len(entries) == _MAX_DIFF_FILES}
