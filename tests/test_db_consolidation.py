"""Tests for the consolidated single-database layout (.soren/soren.db).

Covers: central db module pragmas, multi-service coexistence in ONE file,
SOREN_DB env override, schema_version seeding, and the startup migration guard.
"""

import logging
import sqlite3
import uuid
from pathlib import Path

from src.server.config import Settings, settings
from src.server.services import db
from src.server.services.conversation_store import conversation_store
from src.server.models.message import Message, MessageType


_TASKS_SCHEMA = """
CREATE TABLE IF NOT EXISTS tasks (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    description     TEXT DEFAULT '',
    project         TEXT DEFAULT '',
    assigned_to     TEXT DEFAULT '',
    status          TEXT DEFAULT 'pending',
    priority        TEXT DEFAULT 'medium',
    source          TEXT DEFAULT 'system',
    parent_id       TEXT DEFAULT '',
    resources       TEXT DEFAULT '[]',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    completed_at    TEXT DEFAULT '',
    linked_workers  TEXT DEFAULT '',
    remarks         TEXT DEFAULT '',
    tags            TEXT DEFAULT '[]',
    due_date        TEXT DEFAULT ''
);
"""


# ── (a) Pragmas ────────────────────────────────────────────────────────────────


def test_get_db_pragmas_active():
    """Every get_db() connection runs in WAL mode with the standard pragma set."""
    with db.get_db() as conn:
        assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        assert conn.execute("PRAGMA busy_timeout").fetchone()[0] == 5000
        assert conn.execute("PRAGMA synchronous").fetchone()[0] == 1  # NORMAL
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        # Row factory is sqlite3.Row
        conn.execute("CREATE TABLE IF NOT EXISTS _pragma_probe (x INTEGER)")
        conn.execute("INSERT INTO _pragma_probe (x) VALUES (42)")
        row = conn.execute("SELECT x FROM _pragma_probe").fetchone()
        assert row["x"] == 42


def test_connect_applies_pragmas_to_explicit_path(tmp_path):
    """db.connect(path) applies the same pragmas to non-default paths."""
    other = tmp_path / "elsewhere" / "soren.db"
    conn = db.connect(other)
    try:
        assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        assert conn.execute("PRAGMA busy_timeout").fetchone()[0] == 5000
    finally:
        conn.close()
    assert other.exists()


# ── (b) Multi-service coexistence in ONE file ─────────────────────────────────


def test_services_share_single_db_file(client):
    """Conversation store tables and tasks route tables coexist in one soren.db.

    The conftest fixture points everything at <tmp>/.soren/soren.db; this test
    writes through two independent consumers and verifies both land in the
    same physical file.
    """
    db_path = db.get_db_path()
    assert db_path.name == "soren.db"
    # The conversation store instance points at the exact same file
    assert Path(conversation_store.db_path) == db_path

    # 1. conversation_store: insert + read a message
    msg_id = str(uuid.uuid4())
    conversation_store.store_message(
        Message(
            id=msg_id,
            from_agent="supervisor",
            to_agent="worker-db-test",
            type=MessageType.TASK,
            content="consolidated db check",
        )
    )
    stored = conversation_store.get_messages(agent_id="worker-db-test")
    assert any(m.id == msg_id for m in stored)

    # 2. tasks route: create the tasks schema (normally done by tools/tasks or
    #    the migrator), then insert + read through the HTTP API
    with db.get_db() as conn:
        conn.executescript(_TASKS_SCHEMA)

    resp = client.post("/api/tasks", json={"title": "Consolidation check", "source": "user"})
    assert resp.status_code == 201, resp.text
    task_id = resp.json()["id"]

    resp = client.get(f"/api/tasks/{task_id}")
    assert resp.status_code == 200
    assert resp.json()["title"] == "Consolidation check"

    # 3. Both tables (plus data) exist in the SAME physical file
    raw = sqlite3.connect(str(db_path))
    try:
        tables = {
            r[0]
            for r in raw.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        assert {"messages", "tasks"} <= tables
        assert raw.execute(
            "SELECT COUNT(*) FROM messages WHERE id = ?", (msg_id,)
        ).fetchone()[0] == 1
        assert raw.execute(
            "SELECT COUNT(*) FROM tasks WHERE id = ?", (task_id,)
        ).fetchone()[0] == 1
    finally:
        raw.close()


# ── (c) SOREN_DB env override ─────────────────────────────────────────────────


def test_soren_db_env_override(tmp_path, monkeypatch):
    """SOREN_DB env var overrides the default db path in Settings."""
    custom = tmp_path / "custom" / "state.db"
    monkeypatch.setenv("SOREN_DB", str(custom))
    fresh = Settings()
    assert fresh.db_path == custom


def test_get_db_path_respects_settings_override(tmp_path):
    """get_db_path() resolves dynamically from settings.db_path."""
    original = settings.db_path
    try:
        override = tmp_path / "override" / "soren.db"
        settings.db_path = override
        assert db.get_db_path() == override
        assert db.DB_PATH == override  # module-level attribute stays live
        # Connections actually go to the overridden file
        with db.get_db() as conn:
            conn.execute("CREATE TABLE t (x INTEGER)")
        assert override.exists()
    finally:
        settings.db_path = original


def test_get_db_path_defaults_to_soren_dir(tmp_path):
    """With no override, the path derives from soren_dir: <soren_dir>/soren.db."""
    original = settings.db_path
    try:
        settings.db_path = None
        assert db.get_db_path() == Path(settings.soren_dir) / "soren.db"
    finally:
        settings.db_path = original


# ── schema_version ────────────────────────────────────────────────────────────


def test_init_schema_version_seeds_once():
    """init_schema_version creates the table and seeds version=1 exactly once."""
    db.init_schema_version()
    db.init_schema_version()  # idempotent
    with db.get_db() as conn:
        rows = conn.execute(
            "SELECT version, applied_at FROM schema_version"
        ).fetchall()
    assert len(rows) == 1
    assert rows[0]["version"] == 1
    assert rows[0]["applied_at"]


# ── Startup migration guard ───────────────────────────────────────────────────


def test_migration_guard_warns_when_legacy_unmigrated(caplog):
    """Legacy DB files + empty soren.db tables → loud warning, no auto-migration."""
    # Simulate a legacy tasks.db with data in the (temp) soren dir
    legacy = Path(settings.soren_dir) / "tasks.db"
    conn = sqlite3.connect(str(legacy))
    conn.execute("CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT)")
    conn.execute("INSERT INTO tasks VALUES ('t_legacy01', 'old task')")
    conn.commit()
    conn.close()

    state = db.check_migration_state()
    assert "tasks.db" in state["legacy_files"]
    assert "tasks.db" in state["unmigrated"]
    assert state["migration_needed"] is True

    with caplog.at_level(logging.WARNING, logger="src.server.services.db"):
        needed = db.warn_if_migration_needed()
    assert needed is True
    assert "tools/migrate-state" in caplog.text
    # Guard must not touch the legacy file or auto-migrate
    with db.get_db() as conn:
        assert not db.table_exists(conn, "tasks") or conn.execute(
            "SELECT COUNT(*) FROM tasks"
        ).fetchone()[0] == 0


def test_migration_guard_quiet_when_migrated():
    """Once soren.db holds the data, the guard reports nothing to do."""
    legacy = Path(settings.soren_dir) / "tasks.db"
    legacy.touch()  # legacy file still around

    with db.get_db() as conn:
        conn.executescript(_TASKS_SCHEMA)
        conn.execute(
            "INSERT INTO tasks (id, title, created_at, updated_at) "
            "VALUES ('t_migrated', 'migrated', '2026-01-01', '2026-01-01')"
        )

    state = db.check_migration_state()
    assert state["migration_needed"] is False
    assert db.warn_if_migration_needed() is False


def test_migration_guard_no_legacy_files():
    """Fresh install (no legacy files) → nothing to migrate."""
    state = db.check_migration_state()
    assert state == {"legacy_files": [], "unmigrated": [], "migration_needed": False}


def test_registry_json_bootstrap_defers_to_legacy_db(monkeypatch):
    """The registry's JSON import must not preempt ./tools/migrate-state.

    When the legacy agent_registry.db still exists, its rows are authoritative
    (the JSON file is a possibly-stale derived cache) — so the bootstrap skips.
    Without a legacy DB (fresh install from the JSON-only era) it still runs.
    """
    import src.server.services.agent_registry as reg_mod

    soren = Path(settings.soren_dir)
    json_cache = soren / "agent_registry.json"
    json_cache.write_text(
        '{"worker-x": {"agent_id": "ag_test0001", "type": "worker", "status": "IDLE"}}'
    )
    monkeypatch.setattr(reg_mod, "JSON_CACHE_PATH", json_cache)

    # Legacy registry DB present → bootstrap defers to the migrator
    legacy = soren / "agent_registry.db"
    legacy.touch()
    r1 = reg_mod.AgentRegistry(db_path=soren / "with-legacy.db")
    assert r1.get_registered_agents() == set()

    # No legacy DB → JSON bootstrap still runs (fresh-install upgrade path)
    legacy.unlink()
    r2 = reg_mod.AgentRegistry(db_path=soren / "no-legacy.db")
    assert "worker-x" in r2.get_registered_agents()


# ── Clean shutdown (backlog 3dfa022a / 6fdcaa79: WAL corruption recurring
#    across restarts, traced to this connection never being explicitly
#    checkpointed/closed before process exit) ──────────────────────────────────


def test_agent_registry_close_checkpoints_and_closes(monkeypatch, tmp_path):
    """close() folds the WAL back into the main file and drops the connection.

    This is the actual fix: main.py's lifespan shutdown now calls
    agent_registry.close() as its last step. Simulate that here directly
    against a throwaway registry (not the shared `registry_module.agent_registry`
    singleton the autouse fixture manages) so this test can't leave the
    shared instance closed for whatever runs after it.
    """
    import src.server.services.agent_registry as reg_mod

    db_path = tmp_path / "shutdown-test.db"
    registry = reg_mod.AgentRegistry(db_path=db_path)
    registry.register("worker-shutdown-test", {"type": "worker", "status": "IDLE"})

    # Confirm there's actually WAL content to checkpoint before closing.
    assert registry._conn is not None
    wal_pages_before = registry._conn.execute("PRAGMA wal_checkpoint(PASSIVE)").fetchone()
    assert wal_pages_before is not None  # (busy, log_frames, checkpointed_frames)

    registry.close()
    assert registry._conn is None

    # A fresh connection to the same file sees the write and reports no
    # leftover WAL frames needing a checkpoint (i.e., close() actually
    # checkpointed rather than just dropping the connection).
    import sqlite3
    fresh = sqlite3.connect(str(db_path))
    try:
        assert fresh.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        busy, log_frames, checkpointed = fresh.execute("PRAGMA wal_checkpoint(PASSIVE)").fetchone()
        assert log_frames in (0, checkpointed)  # nothing left uncheckpointed
        row = fresh.execute("SELECT data FROM agents WHERE key = ?", ("worker-shutdown-test",)).fetchone()
        assert row is not None
    finally:
        fresh.close()

    # close() is idempotent — calling it again (e.g. a double-shutdown
    # signal) must not raise.
    registry.close()


def test_agent_registry_close_is_safe_when_already_closed():
    """A registry with no open connection just no-ops instead of raising."""
    import src.server.services.agent_registry as reg_mod
    import tempfile

    with tempfile.TemporaryDirectory() as d:
        registry = reg_mod.AgentRegistry(db_path=Path(d) / "already-closed.db")
        registry.close()
        assert registry._conn is None
        registry.close()  # no-op, must not raise
        assert registry._conn is None
