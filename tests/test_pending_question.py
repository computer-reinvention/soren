"""Tests for GET /api/agents/{agent_id}/pending-question.

opencode's built-in `question` tool blocks synchronously in the agent's
own TUI until answered, and SOREN's event pipeline only ever learns about
it *after* it completes (the bridge plugin fires PostToolUse, not a
"pending" event) — so an autonomous agent with nobody at the terminal
would have it just sit there invisibly. This endpoint reads the live
state directly from opencode's own session transcript instead.
"""
import json
import sqlite3
from datetime import datetime, timezone

import pytest

from src.server.models.agent import Agent, AgentType, AgentRole, AgentStatus
from src.server.services.agent_manager import agent_manager
from src.server.services.agent_registry import agent_registry


def _make_agent(agent_id: str, status: AgentStatus = AgentStatus.IDLE) -> Agent:
    return Agent(
        id=agent_id,
        name=agent_id,
        type=AgentType.WORKER,
        role=AgentRole.WORKER,
        status=status,
        tmux_window=agent_id,
        session="soren",
        created_at=datetime.now(timezone.utc),
    )


def _make_part_db(path, parts):
    conn = sqlite3.connect(str(path))
    conn.execute(
        "CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, "
        "time_created INTEGER, time_updated INTEGER, data TEXT)"
    )
    conn.executemany(
        "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) "
        "VALUES (?, 'msg1', ?, ?, ?, ?)",
        [(pid, sid, ts, ts, json.dumps(data)) for pid, sid, ts, data in parts],
    )
    conn.commit()
    conn.close()


@pytest.fixture
def fake_opencode_db(tmp_path, monkeypatch):
    db_path = tmp_path / "opencode.db"
    monkeypatch.setenv("SOREN_OPENCODE_DB_PATH", str(db_path))
    return db_path


def _mock_get_agent(monkeypatch, agent: Agent):
    async def fake_get_agent(identifier):
        return agent if identifier == agent.id else None

    monkeypatch.setattr(agent_manager, "get_agent", fake_get_agent)


def test_404_for_unknown_agent(client, monkeypatch):
    async def fake_get_agent(identifier):
        return None

    monkeypatch.setattr(agent_manager, "get_agent", fake_get_agent)
    resp = client.get("/api/agents/no-such-agent/pending-question")
    assert resp.status_code == 404


def test_sleeping_agent_skips_the_lookup_entirely(client, monkeypatch, fake_opencode_db):
    """A sleeping agent has no live opencode process, so it cannot have a
    question genuinely blocking on an answer right now -- must return
    null without even querying the transcript (guards against showing
    stale pre-sleep data as if it were still pending)."""
    agent = _make_agent("worker-asleep", status=AgentStatus.SLEEPING)
    _mock_get_agent(monkeypatch, agent)

    # Even if a "running" question happens to exist in the transcript for
    # whatever session this agent last used, a sleeping agent must not
    # surface it.
    monkeypatch.setattr(
        agent_registry, "latest_session_id", lambda agent_id: "ses_stale"
    )
    _make_part_db(
        fake_opencode_db,
        [
            (
                "prt_1", "ses_stale", 100,
                {
                    "type": "tool", "tool": "question", "callID": "call_1",
                    "state": {"status": "running", "input": {"questions": [{"question": "q?", "options": []}]}},
                },
            ),
        ],
    )

    resp = client.get("/api/agents/worker-asleep/pending-question")
    assert resp.status_code == 200
    assert resp.json() == {"agent_id": "worker-asleep", "pending_question": None}


def test_awake_agent_with_no_known_session_returns_null(client, monkeypatch, fake_opencode_db):
    agent = _make_agent("worker-no-session")
    _mock_get_agent(monkeypatch, agent)
    monkeypatch.setattr(agent_registry, "latest_session_id", lambda agent_id: None)

    resp = client.get("/api/agents/worker-no-session/pending-question")
    assert resp.status_code == 200
    assert resp.json() == {"agent_id": "worker-no-session", "pending_question": None}


def test_awake_agent_with_pending_question_returns_it(client, monkeypatch, fake_opencode_db):
    agent = _make_agent("worker-asking")
    _mock_get_agent(monkeypatch, agent)
    monkeypatch.setattr(agent_registry, "latest_session_id", lambda agent_id: "ses_live")

    question_input = {
        "questions": [
            {
                "question": "Approve deploy?",
                "header": "Deploy check",
                "options": [
                    {"label": "Yes", "description": "Ship it"},
                    {"label": "No", "description": "Hold off"},
                ],
            }
        ]
    }
    _make_part_db(
        fake_opencode_db,
        [
            (
                "prt_1", "ses_live", 100,
                {
                    "type": "tool", "tool": "question", "callID": "call_abc",
                    "state": {"status": "running", "input": question_input},
                },
            ),
        ],
    )

    resp = client.get("/api/agents/worker-asking/pending-question")
    assert resp.status_code == 200
    body = resp.json()
    assert body["agent_id"] == "worker-asking"
    assert body["pending_question"]["call_id"] == "call_abc"
    assert body["pending_question"]["questions"] == question_input["questions"]


def test_awake_agent_with_already_answered_question_returns_null(
    client, monkeypatch, fake_opencode_db
):
    agent = _make_agent("worker-answered")
    _mock_get_agent(monkeypatch, agent)
    monkeypatch.setattr(agent_registry, "latest_session_id", lambda agent_id: "ses_done")

    _make_part_db(
        fake_opencode_db,
        [
            (
                "prt_1", "ses_done", 100,
                {
                    "type": "tool", "tool": "question", "callID": "call_x",
                    "state": {
                        "status": "completed",
                        "input": {"questions": [{"question": "q?", "options": []}]},
                        "output": "answered",
                    },
                },
            ),
        ],
    )

    resp = client.get("/api/agents/worker-answered/pending-question")
    assert resp.status_code == 200
    assert resp.json() == {"agent_id": "worker-answered", "pending_question": None}
