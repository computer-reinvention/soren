"""Central SQLite database module — ONE consolidated database for all of soren.

All Python-side state (tasks, task_dependencies, task_status_history, messages,
agent_archives, agent_events, thoughts, failure_log, heartbeat_history, agents,
users, memories, schema_version) lives in a single SQLite file:

    <project_root>/.soren/soren.db      (override with the SOREN_DB env var)

Every consumer resolves the path through :func:`get_db_path` (dynamic — reads
settings on each call so tests can redirect it) and opens connections through
:func:`get_db` / :func:`connect`, which apply the standard pragma set:

    PRAGMA journal_mode=WAL;
    PRAGMA busy_timeout=5000;
    PRAGMA synchronous=NORMAL;
    PRAGMA foreign_keys=ON;

Re-applying these on every connection is cheap (journal_mode=WAL is a no-op
once the database is already in WAL mode).

The legacy databases (tasks.db, conversations.db, agent_registry.db, auth.db,
memories.db) are migrated by the one-time bash migrator `./tools/migrate-state`
— this module never auto-migrates; it only warns at startup (see
:func:`warn_if_migration_needed`).
"""

import logging
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, Optional

from ..config import settings

logger = logging.getLogger(__name__)

# Legacy per-domain database files (pre-consolidation), relative to soren_dir.
# Maps legacy file → a "marker" table that should hold its data in soren.db
# after ./tools/migrate-state has run.
LEGACY_DB_MARKERS = {
    "tasks.db": "tasks",
    "conversations.db": "messages",
    "agent_registry.db": "agents",
    "auth.db": "users",
    "memories.db": "memories",
}


def get_db_path() -> Path:
    """Resolve the consolidated database path.

    Priority: settings.db_path (SOREN_DB env override) if set, otherwise
    <soren_dir>/soren.db. Resolved dynamically on every call so tests can
    redirect it by mutating settings.
    """
    if settings.db_path is not None:
        return Path(settings.db_path)
    return Path(settings.soren_dir) / "soren.db"


def __getattr__(name: str):
    """Module-level DB_PATH attribute, always resolved live from settings."""
    if name == "DB_PATH":
        return get_db_path()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def apply_connection_pragmas(conn: sqlite3.Connection) -> None:
    """Apply the standard pragma set to a connection (idempotent, cheap)."""
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=ON")


def connect(db_path: Optional[Path] = None) -> sqlite3.Connection:
    """Open a connection to the consolidated DB with standard pragmas applied.

    Caller is responsible for commit/close (or use get_db() instead).
    """
    path = Path(db_path) if db_path is not None else get_db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=5)
    conn.row_factory = sqlite3.Row
    apply_connection_pragmas(conn)
    return conn


@contextmanager
def get_db(db_path: Optional[Path] = None) -> Iterator[sqlite3.Connection]:
    """Context-managed connection: commits on success, always closes.

    Accepts an optional explicit path so stores that support per-instance
    db_path overrides (used heavily by tests) can share the same plumbing.
    """
    conn = connect(db_path)
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def table_exists(conn: sqlite3.Connection, table: str) -> bool:
    """Return True if a table exists in the connected database."""
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table,),
    ).fetchone()
    return row is not None


def init_schema_version() -> None:
    """Create the schema_version table and seed version=1 if empty.

    Called from the FastAPI lifespan at startup.
    """
    with get_db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_version (
                version    INTEGER PRIMARY KEY,
                applied_at TEXT
            )
            """
        )
        count = conn.execute("SELECT COUNT(*) FROM schema_version").fetchone()[0]
        if count == 0:
            conn.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (1, ?)",
                (datetime.now(timezone.utc).isoformat(),),
            )


def _table_has_rows(conn: sqlite3.Connection, table: str) -> bool:
    if not table_exists(conn, table):
        return False
    return conn.execute(f"SELECT 1 FROM {table} LIMIT 1").fetchone() is not None


def check_migration_state() -> dict:
    """Inspect the consolidated DB vs legacy DB files (read-only).

    Returns:
        {
          "legacy_files": [legacy .db filenames that still exist],
          "unmigrated": [legacy files whose marker table in soren.db is
                         missing or empty],
          "migration_needed": bool,
        }
    """
    soren_dir = Path(settings.soren_dir)
    db_path = get_db_path()

    legacy_files = [
        name for name in LEGACY_DB_MARKERS
        if (soren_dir / name).exists() and (soren_dir / name) != db_path
    ]
    if not legacy_files:
        return {"legacy_files": [], "unmigrated": [], "migration_needed": False}

    unmigrated: list[str] = []
    try:
        with get_db() as conn:
            for name in legacy_files:
                if not _table_has_rows(conn, LEGACY_DB_MARKERS[name]):
                    unmigrated.append(name)
    except sqlite3.Error as e:
        logger.warning("Could not inspect %s for migration state: %s", db_path, e)
        unmigrated = list(legacy_files)

    return {
        "legacy_files": legacy_files,
        "unmigrated": unmigrated,
        "migration_needed": bool(unmigrated),
    }


def warn_if_migration_needed() -> bool:
    """Log a loud warning if legacy DB data has not been migrated into soren.db.

    Never auto-migrates and never raises — migration is an explicit operator
    action (./tools/migrate-state). Returns True if migration appears needed.
    """
    state = check_migration_state()
    if not state["migration_needed"]:
        if state["legacy_files"]:
            logger.info(
                "Legacy database files still present (%s) but soren.db already "
                "holds their data — you may archive the legacy files.",
                ", ".join(state["legacy_files"]),
            )
        return False

    banner = "=" * 70
    logger.warning(
        "\n%s\n"
        "!!  DATABASE MIGRATION REQUIRED\n"
        "!!  Legacy database files exist in %s but their data has NOT been\n"
        "!!  migrated into the consolidated database %s\n"
        "!!  (missing/empty tables for: %s)\n"
        "!!\n"
        "!!  Run the one-time migrator:  ./tools/migrate-state\n"
        "!!\n"
        "!!  The server will start anyway, but it will NOT see pre-existing\n"
        "!!  tasks/messages/agents/users/memories until you migrate.\n"
        "%s",
        banner,
        settings.soren_dir,
        get_db_path(),
        ", ".join(state["unmigrated"]),
        banner,
    )
    return True
