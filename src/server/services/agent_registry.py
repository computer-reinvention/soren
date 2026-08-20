"""SQLite-backed agent registry.

The agents table in the consolidated .soren/soren.db is the SINGLE MASTER for
agent state (see services/db.py). Bash writers go through
soren_registry_update in tools/lib/opencode.sh, which writes the same table.

- WAL mode for safe concurrent reads
- Atomic writes — no partial-write corruption
- .soren/agent_registry.json is a REGENERATED READ-ONLY VIEW of the table,
  kept for shell-script jq readers (compact.sh, monitor.sh, hooks, tools).
  It is re-exported after every committed write, in the same byte format the
  bash writers produce (2-space indent, raw UTF-8, trailing newline), so
  either writer regenerating it yields identical bytes for identical state.
- The ONLY code path that treats the JSON file as input is the documented
  fresh-install bootstrap (_migrate_from_json), which runs once when the
  agents table is empty.
"""

import json
import logging
import sqlite3
import string
import random
import threading
from pathlib import Path
from typing import Optional, Set, Dict, Any
from datetime import datetime

from .db import apply_connection_pragmas, get_db_path

logger = logging.getLogger(__name__)

JSON_CACHE_PATH = Path(".soren/agent_registry.json")

# Well-known agent IDs
SUPERVISOR_PRIME_AGENT_ID = "ag_0000prim"


def generate_agent_id(existing_ids: Set[str] = frozenset()) -> str:
    """Generate a unique agent ID: ag_ + 8 random alphanumeric chars."""
    chars = string.ascii_lowercase + string.digits
    for _ in range(100):
        agent_id = "ag_" + "".join(random.choices(chars, k=8))
        if agent_id not in existing_ids:
            return agent_id
    raise RuntimeError("Failed to generate unique agent ID after 100 attempts")


class AgentRegistry:
    """
    SQLite-backed agent registry.

    Schema: one row per agent, keyed by window-based ID.
    - `key`: window-based ID (name or session:name)  — PRIMARY KEY
    - `agent_id`: ag_xxx unique ID                   — UNIQUE INDEX
    - `status`: current status string                — indexed for fast filtering
    - `data`: full JSON blob of all agent metadata

    The JSON blob is the source of truth for all fields; key/agent_id/status
    are denormalised columns for fast SQL queries without JSON parsing.
    """

    def __init__(self, db_path: Optional[Path] = None):
        self._lock = threading.Lock()
        self._conn: Optional[sqlite3.Connection] = None
        self.db_path = Path(db_path) if db_path else get_db_path()
        self._open(import_json=True)

    def _open(self, import_json: bool = False):
        """Open the persistent connection to self.db_path with standard pragmas."""
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(
            str(self.db_path),
            timeout=5,
            check_same_thread=False,
            isolation_level=None,   # autocommit — we manage transactions explicitly
        )
        # WAL + busy_timeout + synchronous + foreign_keys — set once on this
        # long-lived connection (per-call connections re-apply them each time).
        apply_connection_pragmas(self._conn)
        self._create_schema()
        if import_json:
            self._migrate_from_json()

    def reconnect(self, db_path: Optional[Path] = None):
        """Close and reopen the persistent connection (used by tests).

        Skips the one-time JSON import — that bootstrap only runs at process
        startup so a reconnect never re-imports stale cache data.
        """
        with self._lock:
            if self._conn is not None:
                try:
                    self._conn.close()
                except sqlite3.Error:
                    pass
                self._conn = None
        self.db_path = Path(db_path) if db_path else get_db_path()
        self._open(import_json=False)

    def _create_schema(self):
        with self._lock:
            self._conn.executescript("""
                BEGIN;
                CREATE TABLE IF NOT EXISTS agents (
                    key        TEXT PRIMARY KEY,
                    agent_id   TEXT,
                    status     TEXT,
                    data       TEXT NOT NULL DEFAULT '{}'
                );
                CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_id
                    ON agents(agent_id) WHERE agent_id IS NOT NULL;
                CREATE INDEX IF NOT EXISTS idx_status
                    ON agents(status);
                COMMIT;
            """)

    def _migrate_from_json(self):
        """One-time import from agent_registry.json → SQLite (runs only when DB is empty).

        Skipped when the legacy .soren/agent_registry.db still exists: the JSON
        file is only a derived write-through cache of it (and may be stale), and
        ./tools/migrate-state copies the authoritative rows from the legacy DB.
        This path remains for fresh installs upgrading from the JSON-only era.
        """
        if not JSON_CACHE_PATH.exists():
            return
        legacy_db = JSON_CACHE_PATH.with_name("agent_registry.db")
        if legacy_db.exists() and legacy_db.resolve() != self.db_path.resolve():
            return
        count = self._conn.execute("SELECT COUNT(*) FROM agents").fetchone()[0]
        if count > 0:
            return
        try:
            with open(JSON_CACHE_PATH) as f:
                agents: Dict[str, Any] = json.load(f)
            with self._lock:
                self._conn.execute("BEGIN")
                for key, entry in agents.items():
                    self._conn.execute(
                        "INSERT OR IGNORE INTO agents(key, agent_id, status, data) VALUES (?,?,?,?)",
                        (key, entry.get("agent_id"), entry.get("status"), json.dumps(entry)),
                    )
                self._conn.execute("COMMIT")
        except Exception as e:
            logger.warning("JSON migration failed: %s", e)

    def _write_json_cache(self):
        """Regenerate the read-only JSON view for shell-script consumers.

        Called AFTER the sqlite write has committed — sqlite is the master,
        the JSON file is derived state only. The byte format (2-space indent,
        insertion order, raw UTF-8, trailing newline) matches what the bash
        writer (tools/lib/opencode.sh) produces via `jq .`, so regenerations
        from either side are byte-stable for identical table state.
        """
        try:
            rows = self._conn.execute("SELECT key, data FROM agents").fetchall()
            agents: Dict[str, Any] = {}
            for key, data_str in rows:
                try:
                    agents[key] = json.loads(data_str)
                except Exception as e:
                    logger.warning("JSON parse failed for agent %s: %s", key, e)
            tmp = JSON_CACHE_PATH.with_suffix(".tmp")
            JSON_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
            tmp.write_text(json.dumps(agents, indent=2, ensure_ascii=False) + "\n")
            tmp.rename(JSON_CACHE_PATH)
        except Exception as e:
            logger.warning("JSON cache write failed: %s", e)

    def _get_all_agent_ids(self) -> Set[str]:
        rows = self._conn.execute(
            "SELECT agent_id FROM agents WHERE agent_id IS NOT NULL"
        ).fetchall()
        return {row[0] for row in rows}

    def _migrate_entry(self, key: str, entry: Dict[str, Any]) -> Dict[str, Any]:
        """Add missing fields to a legacy entry; persists if anything was added."""
        changed = False
        if "agent_id" not in entry:
            entry["agent_id"] = (
                SUPERVISOR_PRIME_AGENT_ID
                if key == "supervisor"
                else generate_agent_id(self._get_all_agent_ids())
            )
            changed = True
        if "display_name" not in entry:
            entry["display_name"] = entry.get("window", key)
            changed = True
        if "role" not in entry:
            entry["role"] = "supervisor" if entry.get("type") == "supervisor" else "worker"
            changed = True
        if "project_id" not in entry:
            entry["project_id"] = "soren"
            changed = True
        if changed:
            self._upsert_no_cache(key, entry)
        return entry

    def _upsert_no_cache(self, key: str, entry: Dict[str, Any]):
        """Write a single row without updating the JSON cache (caller does that)."""
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO agents(key, agent_id, status, data) VALUES (?,?,?,?)",
                (key, entry.get("agent_id"), entry.get("status"), json.dumps(entry)),
            )

    def _upsert(self, key: str, entry: Dict[str, Any]):
        """Write a single row and refresh the JSON cache."""
        self._upsert_no_cache(key, entry)
        self._write_json_cache()

    # ── Public interface (same as before) ─────────────────────────────────────

    def register(self, key: str, metadata: Optional[Dict[str, Any]] = None):
        """Register a new agent."""
        metadata = metadata or {}
        if "agent_id" not in metadata:
            metadata["agent_id"] = (
                SUPERVISOR_PRIME_AGENT_ID
                if (key == "supervisor" or metadata.get("type") == "supervisor")
                else generate_agent_id(self._get_all_agent_ids())
            )
        entry = {
            "registered_at": metadata.get("created_at", datetime.now().isoformat()),
            "type": metadata.get("type", "worker"),
            "created_by": metadata.get("created_by", "system"),
            "agent_id": metadata["agent_id"],
            "display_name": metadata.get("display_name", metadata.get("window", key)),
            "role": metadata.get(
                "role",
                "supervisor" if metadata.get("type") == "supervisor" else "worker",
            ),
            "project_id": metadata.get("project_id", "soren"),
            **metadata,
        }
        self._upsert(key, entry)
        return entry

    def unregister(self, key: str) -> bool:
        """Hard-delete an agent from the registry. Returns True if it existed."""
        with self._lock:
            cursor = self._conn.execute("DELETE FROM agents WHERE key = ?", (key,))
        deleted = cursor.rowcount > 0
        if deleted:
            self._write_json_cache()
        return deleted

    def is_registered(self, key: str) -> bool:
        row = self._conn.execute(
            "SELECT 1 FROM agents WHERE key = ?", (key,)
        ).fetchone()
        return row is not None

    def get_registered_agents(self) -> Set[str]:
        rows = self._conn.execute("SELECT key FROM agents").fetchall()
        return {row[0] for row in rows}

    def get_agent_metadata(self, key: str) -> Optional[Dict[str, Any]]:
        row = self._conn.execute(
            "SELECT data FROM agents WHERE key = ?", (key,)
        ).fetchone()
        if not row:
            return None
        try:
            entry = json.loads(row[0])
        except Exception as e:
            logger.warning("JSON parse failed for agent %s: %s", key, e)
            return None
        return self._migrate_entry(key, entry)

    def find_by_agent_id(self, agent_id: str) -> Optional[tuple[str, Dict[str, Any]]]:
        row = self._conn.execute(
            "SELECT key, data FROM agents WHERE agent_id = ?", (agent_id,)
        ).fetchone()
        if not row:
            return None
        try:
            entry = json.loads(row[1])
        except Exception as e:
            logger.warning("JSON parse failed for agent_id %s: %s", agent_id, e)
            return None
        return (row[0], self._migrate_entry(row[0], entry))

    def find_by_display_name(self, display_name: str) -> Optional[tuple[str, Dict[str, Any]]]:
        rows = self._conn.execute("SELECT key, data FROM agents").fetchall()
        for key, data_str in rows:
            try:
                entry = json.loads(data_str)
            except Exception as e:
                logger.warning("JSON parse failed for agent %s: %s", key, e)
                continue
            entry = self._migrate_entry(key, entry)
            if entry.get("display_name") == display_name:
                return (key, entry)
        return None

    def get_all_entries(self) -> Dict[str, Dict[str, Any]]:
        rows = self._conn.execute("SELECT key, data FROM agents").fetchall()
        result: Dict[str, Dict[str, Any]] = {}
        needs_save = False
        for key, data_str in rows:
            try:
                entry = json.loads(data_str)
            except Exception as e:
                logger.warning("JSON parse failed for agent %s: %s", key, e)
                continue
            old = dict(entry)
            entry = self._migrate_entry(key, entry)
            if entry != old:
                needs_save = True
            result[key] = entry
        if needs_save:
            self._write_json_cache()
        return result

    def update_status(self, key: str, status: str, last_activity: str):
        row = self._conn.execute(
            "SELECT data FROM agents WHERE key = ?", (key,)
        ).fetchone()
        if not row:
            return
        try:
            entry = json.loads(row[0])
        except Exception as e:
            logger.warning("JSON parse failed for agent %s in update_status: %s", key, e)
            return
        entry["status"] = status
        entry["last_activity"] = last_activity
        with self._lock:
            self._conn.execute(
                "UPDATE agents SET status = ?, data = ? WHERE key = ?",
                (status, json.dumps(entry), key),
            )
        self._write_json_cache()

    def cleanup_stale(self, existing_windows: Set[str]):
        """Mark SLEEPING any agent whose tmux window no longer exists.

        This handles unexpected window deaths (crash, OOM, etc.).
        Agents that were explicitly killed via remove_agent() are already
        hard-deleted by that point, so they won't appear here.
        """
        rows = self._conn.execute(
            "SELECT key, status, data FROM agents"
        ).fetchall()
        stale: Set[str] = set()
        changed = False
        with self._lock:
            self._conn.execute("BEGIN")
            for key, current_status, data_str in rows:
                if key not in existing_windows and current_status != "SLEEPING":
                    try:
                        entry = json.loads(data_str)
                    except Exception as e:
                        logger.warning("JSON parse failed for agent %s in cleanup_stale: %s", key, e)
                        entry = {}
                    entry["status"] = "SLEEPING"
                    self._conn.execute(
                        "UPDATE agents SET status = 'SLEEPING', data = ? WHERE key = ?",
                        (json.dumps(entry), key),
                    )
                    stale.add(key)
                    changed = True
            self._conn.execute("COMMIT")
        if changed:
            self._write_json_cache()
        return stale

    def mark_sleeping(self, key: str):
        """Mark an agent SLEEPING (used for unexpected window loss)."""
        row = self._conn.execute(
            "SELECT data FROM agents WHERE key = ?", (key,)
        ).fetchone()
        if not row:
            return
        try:
            entry = json.loads(row[0])
        except Exception as e:
            logger.warning("JSON parse failed for agent %s in mark_sleeping: %s", key, e)
            return
        entry["status"] = "SLEEPING"
        # Clear the opencode port: the window is gone, and a recycled port
        # must never route HTTP messages to a different agent later.
        entry.pop("oc_port", None)
        with self._lock:
            self._conn.execute(
                "UPDATE agents SET status = 'SLEEPING', data = ? WHERE key = ?",
                (json.dumps(entry), key),
            )
        self._write_json_cache()

    def set_keep_awake(self, key: str, value: bool):
        """Persist keep_awake flag for an agent."""
        row = self._conn.execute(
            "SELECT data FROM agents WHERE key = ?", (key,)
        ).fetchone()
        if not row:
            return
        try:
            entry = json.loads(row[0])
        except Exception as e:
            logger.warning("JSON parse failed for agent %s in set_keep_awake: %s", key, e)
            return
        entry["keep_awake"] = value
        with self._lock:
            self._conn.execute(
                "UPDATE agents SET data = ? WHERE key = ?",
                (json.dumps(entry), key),
            )
        self._write_json_cache()

    def mark_awake(self, key: str):
        """Mark a sleeping agent as IDLE (window has been re-created)."""
        row = self._conn.execute(
            "SELECT data FROM agents WHERE key = ?", (key,)
        ).fetchone()
        if not row:
            return
        try:
            entry = json.loads(row[0])
        except Exception as e:
            logger.warning("JSON parse failed for agent %s in mark_awake: %s", key, e)
            return
        entry["status"] = "IDLE"
        with self._lock:
            self._conn.execute(
                "UPDATE agents SET status = 'IDLE', data = ? WHERE key = ?",
                (json.dumps(entry), key),
            )
        self._write_json_cache()


agent_registry = AgentRegistry()
