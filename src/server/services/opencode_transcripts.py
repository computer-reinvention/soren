"""Real cost/token data straight from opencode's own session transcripts.

SOREN's own usage tracking (``agent_events.usage``, sourced from the
soren-bridge plugin's per-turn token snapshots) only ever gives token
*counts* — turning those into a dollar figure means re-deriving cost with
SOREN's own hardcoded pricing table (see ``budget_guard.py``), which drifts
out of sync with whatever model is actually running (it was priced for
Opus while every agent has run Sonnet for a while) and, unlike this module,
never matches opencode's own number to the cent.

opencode already computes and persists the real, authoritative cost per
session — it's the exact dollar figure its own TUI status bar shows — in
its local SQLite database. This module reads that directly instead of
re-deriving an estimate, so the dashboard shows the same number opencode
itself would.

Everything here is best-effort and read-only: if opencode's database is
missing, unreadable, or simply doesn't have a session we ask about (e.g.
it predates this feature, or was pruned), callers get back an empty
result and are expected to fall back to the token-based estimate rather
than fail outright — this is a "make the real number available when we
can get it" module, not a required dependency.
"""
import logging
import os
import sqlite3
import time
from pathlib import Path

logger = logging.getLogger(__name__)

# Short TTL cache for get_daily_real_cost(), keyed by directory. This
# query used to be a genuine hot path (BudgetPanel polls
# /api/budget/status every 60s, monitor.sh's budget check every 5min) —
# even with the indexed-query fix below, repeated identical calls within
# a few seconds of each other (e.g. several open dashboard tabs) still
# have no reason to re-hit opencode's database at all. 30s comfortably
# covers that without meaningfully increasing staleness versus the 60s+
# poll intervals that actually consume this.
_DAILY_CACHE_TTL_SECONDS = 30
_daily_cache: dict[str, tuple[float, dict[str, float]]] = {}


def _db_path() -> Path:
    """opencode's own session database.

    Env-overridable (``SOREN_OPENCODE_DB_PATH``) for tests and for any
    deployment where opencode's XDG data dir isn't the plain default.
    """
    override = os.environ.get("SOREN_OPENCODE_DB_PATH")
    if override:
        return Path(override)
    return Path.home() / ".local" / "share" / "opencode" / "opencode.db"


def _connect() -> sqlite3.Connection | None:
    path = _db_path()
    if not path.exists():
        return None
    try:
        # Read-only URI connection: this database belongs to opencode, not
        # SOREN — never risk writing to or locking it.
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=2.0)
        conn.row_factory = sqlite3.Row
        return conn
    except sqlite3.Error:
        logger.warning("Could not open opencode's session database at %s", path, exc_info=True)
        return None


def is_available() -> bool:
    return _db_path().exists()


def get_session_costs(session_ids: list[str]) -> dict[str, dict]:
    """Real cost/tokens per session id, straight from opencode's own DB.

    Returns only the sessions actually found — a session id absent from
    the result (because it predates opencode tracking this, was pruned,
    or the DB is unreachable at all) should be treated by the caller as
    "no real data available" and estimated from SOREN's own token counts
    instead, not silently reported as zero.
    """
    if not session_ids:
        return {}
    conn = _connect()
    if conn is None:
        return {}
    try:
        placeholders = ",".join("?" for _ in session_ids)
        cursor = conn.execute(
            f"""
            SELECT id, cost, tokens_input, tokens_output,
                   tokens_cache_read, tokens_cache_write
            FROM session WHERE id IN ({placeholders})
            """,
            session_ids,
        )
        return {
            row["id"]: {
                "cost_usd": row["cost"] or 0.0,
                "input_tokens": row["tokens_input"] or 0,
                "output_tokens": row["tokens_output"] or 0,
                "cache_read_tokens": row["tokens_cache_read"] or 0,
                "cache_creation_tokens": row["tokens_cache_write"] or 0,
            }
            for row in cursor.fetchall()
        }
    except sqlite3.Error:
        logger.warning("Query against opencode's session database failed", exc_info=True)
        return {}
    finally:
        conn.close()


def get_daily_real_cost(directory: str) -> dict[str, float]:
    """Real per-day cost (UTC date -> USD), summed from every message's own
    already-priced ``cost`` field, scoped to sessions whose working
    directory matches ``directory``.

    The directory scope matters because opencode's database is shared
    across every project a developer points it at on the same machine —
    without it, a dev running opencode against unrelated repos on the same
    laptop would inflate SOREN's own daily figure with unrelated spend.
    Message-level granularity (rather than the session table's running
    total) is what makes day-by-day possible at all: ``session.cost`` is
    cumulative for the session's whole lifetime, not bucketable by day on
    its own.

    Cached for _DAILY_CACHE_TTL_SECONDS per directory — see module docstring.
    """
    now = time.monotonic()
    cached = _daily_cache.get(directory)
    if cached is not None:
        cached_at, result = cached
        if now - cached_at < _DAILY_CACHE_TTL_SECONDS:
            return result

    result = _query_daily_real_cost(directory)
    _daily_cache[directory] = (now, result)
    return result


def _query_daily_real_cost(directory: str) -> dict[str, float]:
    conn = _connect()
    if conn is None:
        return {}
    try:
        # Two steps rather than one JOIN: opencode's `session` table has
        # no index on `directory`, so filtering through a JOIN forces a
        # full scan of the much larger, blob-heavy `message` table (36k+
        # rows, 100+ MB of JSON payloads in a real install) on every call
        # — measured 0.6s. Finding this directory's (typically a couple
        # dozen) session ids first, from the small `session` table, then
        # querying `message` by `session_id IN (...)` hits the existing
        # message_session_time_created_id_idx index instead — measured
        # ~0.08s for the same result, about 7x faster.
        session_rows = conn.execute(
            "SELECT id FROM session WHERE directory = ?", (directory,)
        ).fetchall()
        session_ids = [row["id"] for row in session_rows]
        if not session_ids:
            return {}

        placeholders = ",".join("?" for _ in session_ids)
        cursor = conn.execute(
            f"""
            SELECT
                date(time_created / 1000, 'unixepoch') as day,
                SUM(json_extract(data, '$.cost')) as cost
            FROM message
            WHERE session_id IN ({placeholders})
              AND json_extract(data, '$.cost') IS NOT NULL
            GROUP BY day
            """,
            session_ids,
        )
        return {row["day"]: row["cost"] or 0.0 for row in cursor.fetchall()}
    except sqlite3.Error:
        logger.warning("Daily cost query against opencode's session database failed", exc_info=True)
        return {}
    finally:
        conn.close()
