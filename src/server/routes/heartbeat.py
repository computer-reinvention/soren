import json
import re
import sqlite3
import time
from contextlib import contextmanager

from fastapi import APIRouter, Query
from pydantic import BaseModel
from datetime import datetime, timezone
from typing import Dict, List, Optional
import logging

from ..config import settings
from ..services.db import get_db
from ..websocket.manager import ws_manager

logger = logging.getLogger(__name__)

router = APIRouter()


class HeartbeatData(BaseModel):
    timestamp: float
    sections: Dict[str, str] = {}
    highest_priority: Optional[str] = None
    all_clear: bool = False
    supervisor_idle_seconds: Optional[int] = None
    supervisor_state: Optional[str] = None


class HeartbeatResponse(BaseModel):
    timestamp: float
    sections: Dict[str, str]
    highest_priority: Optional[str]
    all_clear: bool
    received_at: str
    supervisor_idle_seconds: Optional[int] = None
    supervisor_state: Optional[str] = None


class HeartbeatHistoryResponse(BaseModel):
    heartbeats: List[HeartbeatResponse]
    total: int


# In-memory latest heartbeat
_latest_heartbeat: Optional[HeartbeatResponse] = None


# --- Database ---


_SCHEMA = """CREATE TABLE IF NOT EXISTS heartbeat_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp REAL NOT NULL,
    sections TEXT NOT NULL,
    highest_priority TEXT,
    all_clear BOOLEAN NOT NULL DEFAULT 0,
    received_at TEXT NOT NULL,
    supervisor_idle_seconds INTEGER,
    supervisor_state TEXT
)"""


def _migrate_db(conn):
    """Add new columns to existing heartbeat_history tables."""
    cursor = conn.execute("PRAGMA table_info(heartbeat_history)")
    existing_cols = {row[1] for row in cursor.fetchall()}
    if "supervisor_idle_seconds" not in existing_cols:
        conn.execute("ALTER TABLE heartbeat_history ADD COLUMN supervisor_idle_seconds INTEGER")
    if "supervisor_state" not in existing_cols:
        conn.execute("ALTER TABLE heartbeat_history ADD COLUMN supervisor_state TEXT")
    # Supports both get_heartbeat_history's ORDER BY id (already covered by
    # the rowid-backed primary key) and prune_old_heartbeats' DELETE ...
    # WHERE timestamp < ? -- there was no index of any kind on this table
    # before, so that DELETE would otherwise be a full table scan every
    # time it runs.
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_heartbeat_timestamp ON heartbeat_history(timestamp)"
    )


def _init_db():
    """Create heartbeat_history table if it doesn't exist, then migrate."""
    with get_db() as conn:
        conn.execute(_SCHEMA)
        _migrate_db(conn)


_init_db()


@contextmanager
def _get_connection():
    """Get a consolidated-DB connection (standard pragmas) with proper cleanup."""
    with get_db() as conn:
        # Idempotent ensure — the DB path can change under tests, and this is
        # a single cheap DDL statement on an existing table.
        conn.execute(_SCHEMA)
        _migrate_db(conn)
        yield conn


def _store_heartbeat(hb: HeartbeatResponse):
    """Persist a heartbeat record to the database."""
    with _get_connection() as conn:
        conn.execute(
            """INSERT INTO heartbeat_history
               (timestamp, sections, highest_priority, all_clear, received_at,
                supervisor_idle_seconds, supervisor_state)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                hb.timestamp,
                json.dumps(hb.sections),
                hb.highest_priority,
                hb.all_clear,
                hb.received_at,
                hb.supervisor_idle_seconds,
                hb.supervisor_state,
            ),
        )


def prune_old_heartbeats(retention_days: Optional[int] = None) -> int:
    """Delete heartbeat_history rows older than the retention window.

    monitor.sh posts a heartbeat roughly every 5s with nothing anywhere
    ever deleting from this table -- measured at 44,700 rows / 57% of the
    entire consolidated database with zero pruning having ever run.
    Called periodically by main.py's background task; also safe to call
    directly (e.g. from a one-off maintenance script or a test).

    Returns the number of rows deleted.
    """
    days = retention_days if retention_days is not None else settings.heartbeat_retention_days
    cutoff = time.time() - days * 86400
    with _get_connection() as conn:
        cursor = conn.execute(
            "DELETE FROM heartbeat_history WHERE timestamp < ?", (cutoff,)
        )
        return cursor.rowcount


def _row_to_heartbeat(row: sqlite3.Row) -> HeartbeatResponse:
    """Convert a database row to a HeartbeatResponse."""
    sections_raw = row["sections"]
    try:
        sections = json.loads(sections_raw) if sections_raw else {}
    except (json.JSONDecodeError, TypeError):
        sections = {}

    # New columns may not exist in older rows; use safe access
    sup_idle = None
    sup_state = None
    try:
        sup_idle = row["supervisor_idle_seconds"]
    except (IndexError, KeyError):
        pass
    try:
        sup_state = row["supervisor_state"]
    except (IndexError, KeyError):
        pass

    return HeartbeatResponse(
        timestamp=row["timestamp"],
        sections=sections,
        highest_priority=row["highest_priority"],
        all_clear=bool(row["all_clear"]),
        received_at=row["received_at"],
        supervisor_idle_seconds=sup_idle,
        supervisor_state=sup_state,
    )


# --- Routes ---


@router.post("")
async def post_heartbeat(data: HeartbeatData):
    """Accept heartbeat scan data from monitor and broadcast via WebSocket."""
    global _latest_heartbeat

    sup_idle = data.supervisor_idle_seconds
    sup_state = data.supervisor_state

    # Fallback: parse structured supervisor info from sections string
    sup_section = data.sections.get("supervisor", "")
    if sup_idle is None and sup_section:
        idle_s = re.search(r"\((\d+)s idle\)", sup_section)
        if idle_s:
            sup_idle = int(idle_s.group(1))
        else:
            idle_m = re.search(r"\((\d+)m idle\)", sup_section)
            if idle_m:
                sup_idle = int(idle_m.group(1)) * 60
    if sup_state is None and sup_section:
        sup_state = sup_section.split("(")[0].strip() or sup_section

    _latest_heartbeat = HeartbeatResponse(
        timestamp=data.timestamp,
        sections=data.sections,
        highest_priority=data.highest_priority,
        all_clear=data.all_clear,
        received_at=datetime.now(timezone.utc).isoformat(),
        supervisor_idle_seconds=sup_idle,
        supervisor_state=sup_state,
    )

    _store_heartbeat(_latest_heartbeat)

    await ws_manager.broadcast("heartbeat_update", _latest_heartbeat.model_dump())

    return {"success": True}


@router.get("/history", response_model=HeartbeatHistoryResponse)
async def get_heartbeat_history(
    limit: int = Query(50, ge=1, le=500, description="Number of recent heartbeats to return"),
):
    """Return recent heartbeat history from the database."""
    with _get_connection() as conn:
        total = conn.execute("SELECT COUNT(*) FROM heartbeat_history").fetchone()[0]
        cursor = conn.execute(
            "SELECT * FROM heartbeat_history ORDER BY id DESC LIMIT ?",
            (limit,),
        )
        rows = cursor.fetchall()
        heartbeats = [_row_to_heartbeat(row) for row in rows]

    return HeartbeatHistoryResponse(heartbeats=heartbeats, total=total)


@router.get("")
async def get_heartbeat():
    """Return latest heartbeat data.

    Uses in-memory cache first, falls back to latest DB record
    (survives server restart).
    """
    global _latest_heartbeat
    if _latest_heartbeat is None:
        with _get_connection() as conn:
            row = conn.execute(
                "SELECT * FROM heartbeat_history ORDER BY id DESC LIMIT 1"
            ).fetchone()
            if row:
                _latest_heartbeat = _row_to_heartbeat(row)
    if _latest_heartbeat is None:
        return {"status": "no_data", "message": "No heartbeat received yet"}
    return _latest_heartbeat.model_dump()
