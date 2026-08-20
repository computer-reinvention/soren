import json
import sqlite3
from contextlib import contextmanager

from fastapi import APIRouter, Query
from pydantic import BaseModel
from datetime import datetime, timezone
from typing import Dict, List, Optional
import logging

from ..services.db import get_db
from ..websocket.manager import ws_manager

logger = logging.getLogger(__name__)

router = APIRouter()


class HeartbeatData(BaseModel):
    timestamp: float
    sections: Dict[str, str] = {}
    highest_priority: Optional[str] = None
    all_clear: bool = False


class HeartbeatResponse(BaseModel):
    timestamp: float
    sections: Dict[str, str]
    highest_priority: Optional[str]
    all_clear: bool
    received_at: str


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
    received_at TEXT NOT NULL
)"""


def _init_db():
    """Create heartbeat_history table if it doesn't exist."""
    with get_db() as conn:
        conn.execute(_SCHEMA)


_init_db()


@contextmanager
def _get_connection():
    """Get a consolidated-DB connection (standard pragmas) with proper cleanup."""
    with get_db() as conn:
        # Idempotent ensure — the DB path can change under tests, and this is
        # a single cheap DDL statement on an existing table.
        conn.execute(_SCHEMA)
        yield conn


def _store_heartbeat(hb: HeartbeatResponse):
    """Persist a heartbeat record to the database."""
    with _get_connection() as conn:
        conn.execute(
            """INSERT INTO heartbeat_history (timestamp, sections, highest_priority, all_clear, received_at)
               VALUES (?, ?, ?, ?, ?)""",
            (
                hb.timestamp,
                json.dumps(hb.sections),
                hb.highest_priority,
                hb.all_clear,
                hb.received_at,
            ),
        )


def _row_to_heartbeat(row: sqlite3.Row) -> HeartbeatResponse:
    """Convert a database row to a HeartbeatResponse."""
    sections_raw = row["sections"]
    try:
        sections = json.loads(sections_raw) if sections_raw else {}
    except (json.JSONDecodeError, TypeError):
        sections = {}

    return HeartbeatResponse(
        timestamp=row["timestamp"],
        sections=sections,
        highest_priority=row["highest_priority"],
        all_clear=bool(row["all_clear"]),
        received_at=row["received_at"],
    )


# --- Routes ---


@router.post("")
async def post_heartbeat(data: HeartbeatData):
    """Accept heartbeat scan data from monitor and broadcast via WebSocket."""
    global _latest_heartbeat

    _latest_heartbeat = HeartbeatResponse(
        timestamp=data.timestamp,
        sections=data.sections,
        highest_priority=data.highest_priority,
        all_clear=data.all_clear,
        received_at=datetime.now(timezone.utc).isoformat(),
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
