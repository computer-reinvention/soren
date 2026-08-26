"""Regression tests for AgentRegistry.mark_sleeping's session_id capture.

Two independent code paths put an agent to sleep: `tools/workers`'
cmd_sleep (bash, already captured session_id correctly) and auto-sleep
after 30 idle minutes, which kills the tmux window via tmux_service and
calls agent_registry.mark_sleeping() directly -- the path that was
silently skipping the capture entirely, breaking `workers wake` (see
AGENTS.md's documented sleep/wake contract).

Uses a throwaway AgentRegistry(db_path=...) against a temp file, never
the shared `registry_module.agent_registry` singleton, so nothing here
can affect the real, shared instance other tests/the live system depend
on.
"""
import json
import sqlite3

import pytest

import src.server.services.agent_registry as reg_mod


@pytest.fixture
def registry(tmp_path):
    db_path = tmp_path / "sleep-test.db"
    return reg_mod.AgentRegistry(db_path=db_path)


def _seed_agent_event(registry, agent_id: str, session_id: str | None, timestamp: str):
    """Write a minimal agent_events row directly -- mirrors the real
    schema (services/conversation_store.py) closely enough for
    mark_sleeping's own SELECT, without pulling in ConversationStore
    itself (a different service, different table-creation path)."""
    registry._conn.execute(
        """
        CREATE TABLE IF NOT EXISTS agent_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT, session_id TEXT, agent_id TEXT,
            tool_name TEXT, tool_input TEXT, tool_output TEXT,
            timestamp TEXT, message_id TEXT, usage TEXT
        )
        """
    )
    registry._conn.execute(
        "INSERT INTO agent_events (event_type, session_id, agent_id, timestamp) "
        "VALUES ('Stop', ?, ?, ?)",
        (session_id, agent_id, timestamp),
    )
    registry._conn.commit()


def test_mark_sleeping_captures_latest_session_id(registry):
    registry.register("worker-a", {"type": "worker", "status": "IDLE", "oc_port": 42001})
    _seed_agent_event(registry, "worker-a", "ses_old111", "2026-01-01T00:00:00+00:00")
    _seed_agent_event(registry, "worker-a", "ses_new222", "2026-01-01T00:05:00+00:00")

    registry.mark_sleeping("worker-a")

    row = registry._conn.execute("SELECT data FROM agents WHERE key='worker-a'").fetchone()
    entry = json.loads(row[0])
    assert entry["status"] == "SLEEPING"
    assert entry["session_id"] == "ses_new222", "must pick the most recent event, not just any"
    assert "oc_port" not in entry, "oc_port must still be cleared (pre-existing behavior)"


def test_mark_sleeping_gracefully_handles_no_agent_events_table(registry):
    """The agents table exists but agent_events never got created (e.g. a
    fresh registry that conversation_store hasn't touched yet) -- must not
    raise, just proceed without a session_id."""
    registry.register("worker-b", {"type": "worker", "status": "IDLE"})

    registry.mark_sleeping("worker-b")  # must not raise

    row = registry._conn.execute("SELECT data FROM agents WHERE key='worker-b'").fetchone()
    entry = json.loads(row[0])
    assert entry["status"] == "SLEEPING"
    assert "session_id" not in entry


def test_mark_sleeping_gracefully_handles_no_matching_events(registry):
    registry.register("worker-c", {"type": "worker", "status": "IDLE"})
    _seed_agent_event(registry, "some-other-agent", "ses_notmine", "2026-01-01T00:00:00+00:00")

    registry.mark_sleeping("worker-c")

    row = registry._conn.execute("SELECT data FROM agents WHERE key='worker-c'").fetchone()
    entry = json.loads(row[0])
    assert entry["status"] == "SLEEPING"
    assert "session_id" not in entry


def test_mark_sleeping_does_not_clobber_existing_session_id_when_no_new_event(registry):
    """If this particular sleep cycle produced no fresh agent_events row
    (e.g. it slept immediately after being woken, before posting
    anything), a session_id already on record from a previous sleep must
    be preserved, not wiped."""
    registry.register(
        "worker-d", {"type": "worker", "status": "IDLE", "session_id": "ses_previously_known"}
    )

    registry.mark_sleeping("worker-d")

    row = registry._conn.execute("SELECT data FROM agents WHERE key='worker-d'").fetchone()
    entry = json.loads(row[0])
    assert entry["session_id"] == "ses_previously_known"


def test_mark_sleeping_ignores_null_session_id_events(registry):
    """agent_events rows with a NULL session_id (some event types never
    carry one) must be skipped in favor of the latest row that actually
    has one, not treated as "the latest event, so no session"."""
    registry.register("worker-e", {"type": "worker", "status": "IDLE"})
    _seed_agent_event(registry, "worker-e", "ses_real", "2026-01-01T00:00:00+00:00")
    _seed_agent_event(registry, "worker-e", None, "2026-01-01T00:05:00+00:00")

    registry.mark_sleeping("worker-e")

    row = registry._conn.execute("SELECT data FROM agents WHERE key='worker-e'").fetchone()
    entry = json.loads(row[0])
    assert entry["session_id"] == "ses_real"


def test_mark_sleeping_unknown_key_is_a_noop(registry):
    registry.mark_sleeping("no-such-agent")  # must not raise
