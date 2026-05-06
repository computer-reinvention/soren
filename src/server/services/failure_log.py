"""Failure pattern logging — tracks recurring agent/system failures in SQLite.

Schema lives in the shared conversations.db alongside messages and agent_events.
"""

from datetime import datetime, timezone
from typing import Literal, Optional
from collections import defaultdict

from .conversation_store import conversation_store

FailureType = Literal[
    "build_error",
    "test_failure",
    "import_error",
    "runtime_crash",
    "rollback",
    "timeout",
]


def _ensure_table() -> None:
    """Create failure_log table if it doesn't exist (idempotent)."""
    with conversation_store._get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS failure_log (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT    NOT NULL,
                agent_id  TEXT    NOT NULL,
                failure_type TEXT NOT NULL,
                description  TEXT NOT NULL,
                commit_sha   TEXT,
                resolved     BOOLEAN NOT NULL DEFAULT 0
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_failure_log_agent ON failure_log(agent_id)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_failure_log_type ON failure_log(failure_type)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_failure_log_ts ON failure_log(timestamp)"
        )
        # Migration: add root_cause column for RCA analysis results
        cols = [r[1] for r in conn.execute("PRAGMA table_info(failure_log)").fetchall()]
        if "root_cause" not in cols:
            conn.execute("ALTER TABLE failure_log ADD COLUMN root_cause TEXT")


# Ensure table exists at import time
_ensure_table()


def log_failure(
    agent_id: str,
    failure_type: FailureType,
    description: str,
    commit_sha: Optional[str] = None,
    root_cause: Optional[str] = None,
) -> int:
    """Record a failure event. Returns the new row id."""
    with conversation_store._get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO failure_log
                (timestamp, agent_id, failure_type, description, commit_sha, root_cause)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                datetime.now(timezone.utc).isoformat(),
                agent_id,
                failure_type,
                description,
                commit_sha,
                root_cause,
            ),
        )
        return cursor.lastrowid


def get_failure_stats() -> dict:
    """Return failure counts grouped by type and by agent.

    Returns:
        {
          "total": int,
          "by_type": {"build_error": int, ...},
          "by_agent": {"perm-backend": {"total": int, "by_type": {...}}, ...},
          "recent": [last 20 failures, newest first]
        }
    """
    with conversation_store._get_connection() as conn:
        # Counts by failure_type
        cursor = conn.execute(
            "SELECT failure_type, COUNT(*) as cnt FROM failure_log GROUP BY failure_type"
        )
        by_type: dict[str, int] = defaultdict(int)
        for row in cursor.fetchall():
            by_type[row["failure_type"]] = row["cnt"]

        # Counts by agent + type
        cursor = conn.execute(
            """
            SELECT agent_id, failure_type, COUNT(*) as cnt
            FROM failure_log
            GROUP BY agent_id, failure_type
            """
        )
        by_agent: dict[str, dict] = defaultdict(lambda: {"total": 0, "by_type": {}})
        for row in cursor.fetchall():
            entry = by_agent[row["agent_id"]]
            entry["total"] += row["cnt"]
            entry["by_type"][row["failure_type"]] = row["cnt"]

        # Recent failures
        cursor = conn.execute(
            """
            SELECT id, timestamp, agent_id, failure_type, description, commit_sha, resolved
            FROM failure_log
            ORDER BY timestamp DESC
            LIMIT 20
            """
        )
        recent = [
            {
                "id": r["id"],
                "timestamp": r["timestamp"],
                "agent_id": r["agent_id"],
                "failure_type": r["failure_type"],
                "description": r["description"],
                "commit_sha": r["commit_sha"],
                "resolved": bool(r["resolved"]),
                "root_cause": r["root_cause"],
            }
            for r in cursor.fetchall()
        ]

        total = sum(by_type.values())

    return {
        "total": total,
        "by_type": dict(by_type),
        "by_agent": {k: dict(v) for k, v in by_agent.items()},
        "recent": recent,
    }
