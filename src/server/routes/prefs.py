"""Preferences API — reads/writes the `prefs` table in the consolidated DB.

The `prefs` key-value table merges the two legacy JSON stores that had
drifted apart:
  - .soren/preferences.json  (tools/prefs' old file; the live copy had also
    accumulated server-schema keys)
  - .soren/prefs.json        (this route's old file — heartbeat keys, written
    with a non-atomic write_text)
Both are imported once, lazily and verbatim (prefs.json wins on key
conflicts), then renamed *.migrated. tools/prefs reads and writes the same
table.

The GET/PUT response shape was originally just the four heartbeat keys
(HeartbeatIndicator.tsx); P5.2 added `ui_density` for the settings panel
(the flat-object shape and "defaults filled in for missing rows" behavior
are unchanged, just with a 5th key now).

NOTE (shared schema + import): duplicated in tools/prefs — keep in sync.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import json
import logging
import os
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

from ..config import settings
from ..services.db import get_db

logger = logging.getLogger(__name__)

router = APIRouter()

SCHEMA = """
CREATE TABLE IF NOT EXISTS prefs (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TEXT,
    updated_by TEXT
)
"""

# Default heartbeat config (mirrors monitor.sh defaults)
DEFAULT_PREFS = {
    "heartbeat_warn_threshold": 900,
    "heartbeat_nudge_interval": 180,
    "heartbeat_max_nudges": 3,
    "heartbeat_observe_timeout": 1200,
    # P5.2 settings panel: the only setting that actually needs to round-trip
    # through the server rather than living in localStorage — density is the
    # one preference here worth syncing across browsers/devices for the same
    # account. Theme, notifications-enabled, and terminal font/scrollback
    # stay in their existing zustand+localStorage stores (see
    # stores/terminalSettingsStore.ts's docblock) since they're pure
    # client-display concerns with no reason to hit the network on every
    # change, and duplicating them here would just create two sources of
    # truth to keep in sync.
    "ui_density": "comfortable",
}

UI_DENSITY_VALUES = {"comfortable", "compact"}

# Import order matters: prefs.json (this route's old store) is imported second
# so it wins any key conflicts with the drifted preferences.json.
LEGACY_FILES = ("preferences.json", "prefs.json")


class PrefsUpdate(BaseModel):
    heartbeat_warn_threshold: Optional[int] = None
    heartbeat_nudge_interval: Optional[int] = None
    heartbeat_max_nudges: Optional[int] = None
    heartbeat_observe_timeout: Optional[int] = None
    ui_density: Optional[str] = None


def _import_legacy_file(conn: sqlite3.Connection, path: Path) -> None:
    """One-time lazy import of one legacy JSON prefs file.

    Every top-level key except _meta is imported verbatim (value stored as its
    JSON encoding); _meta.updated_at/_meta.updated_by become the rows' audit
    columns. rename() is the atomic claim; the file ends up renamed *.migrated
    so this never runs twice.
    """
    if not path.exists():
        return
    claim = path.with_name(f"{path.name}.importing.{os.getpid()}")
    try:
        path.rename(claim)
    except OSError:
        return  # another process claimed it
    imported = 0
    try:
        data = json.loads(claim.read_text())
        if isinstance(data, dict):
            meta = data.get("_meta") if isinstance(data.get("_meta"), dict) else {}
            ts = meta.get("updated_at") or ""
            by = meta.get("updated_by") or "import"
            for key, value in data.items():
                if key == "_meta":
                    continue
                conn.execute(
                    "INSERT OR REPLACE INTO prefs (key, value, updated_at, updated_by) "
                    "VALUES (?,?,?,?)",
                    (key, json.dumps(value, ensure_ascii=False), ts, by),
                )
                imported += 1
            conn.commit()
    except (json.JSONDecodeError, OSError) as e:
        logger.warning("Could not import legacy prefs file %s: %s", path, e)
    if imported:
        logger.info("Imported %d pref(s) from legacy %s into sqlite", imported, path)
    migrated = path.with_name(f"{path.name}.migrated")
    if migrated.exists():
        migrated = path.with_name(f"{path.name}.migrated.{int(time.time())}.{os.getpid()}")
    try:
        claim.rename(migrated)
    except OSError as e:
        logger.warning("Could not rename %s to %s: %s", claim, migrated, e)


def _init(conn: sqlite3.Connection) -> None:
    conn.execute(SCHEMA)
    for name in LEGACY_FILES:
        _import_legacy_file(conn, Path(settings.soren_dir) / name)


def _parse_value(raw: Optional[str]):
    """Stored values are JSON-encoded scalars; fall back to the raw string."""
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return raw


def _load_prefs(conn: sqlite3.Connection) -> dict:
    """Flat object of the four heartbeat keys, defaults for missing rows."""
    prefs = dict(DEFAULT_PREFS)
    qmarks = ",".join("?" * len(DEFAULT_PREFS))
    rows = conn.execute(
        f"SELECT key, value FROM prefs WHERE key IN ({qmarks})",
        tuple(DEFAULT_PREFS),
    ).fetchall()
    for row in rows:
        value = _parse_value(row["value"])
        if value is not None:
            prefs[row["key"]] = value
    return prefs


@router.get("")
async def get_prefs():
    """Return current preferences."""
    with get_db() as conn:
        _init(conn)
        return _load_prefs(conn)


@router.put("")
async def update_prefs(update: PrefsUpdate):
    """Update preferences. Only provided fields are changed."""
    if update.ui_density is not None and update.ui_density not in UI_DENSITY_VALUES:
        raise HTTPException(
            status_code=422,
            detail=f"ui_density must be one of: {', '.join(sorted(UI_DENSITY_VALUES))}",
        )
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with get_db() as conn:
        _init(conn)
        for key, val in update.model_dump(exclude_none=True).items():
            conn.execute(
                "INSERT OR REPLACE INTO prefs (key, value, updated_at, updated_by) "
                "VALUES (?,?,?,?)",
                (key, json.dumps(val), now, "api"),
            )
        conn.commit()
        return _load_prefs(conn)
