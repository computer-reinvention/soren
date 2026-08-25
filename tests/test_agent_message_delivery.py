"""Regression tests for POST /api/agents/{agent_id}/message's delivery
handling (message-passing fortification pass).

Previously this endpoint ignored tmux_service.send_input()'s result
entirely: it stored the message and broadcast it as sent unconditionally,
so sending to a sleeping/crashed agent returned HTTP 200 {"success": true}
and made the message look delivered in chat history while it never
actually reached the agent. Now a genuine delivery failure raises 503 and
nothing is stored/broadcast.
"""
from datetime import datetime, timezone

import pytest

from src.server.models.agent import Agent, AgentType, AgentRole, AgentStatus
from src.server.services.agent_manager import agent_manager
from src.server.services.tmux_service import tmux_service, TmuxDeliveryError
from src.server.services.conversation_store import conversation_store


def _make_agent(agent_id: str = "worker-1", session: str = "soren") -> Agent:
    return Agent(
        id=agent_id,
        name=agent_id,
        type=AgentType.WORKER,
        role=AgentRole.WORKER,
        status=AgentStatus.IDLE,
        tmux_window=agent_id,
        session=session,
        created_at=datetime.now(timezone.utc),
    )


@pytest.fixture
def registered_agent(monkeypatch):
    """Make agent_manager.get_agent('worker-1') resolve to a fake agent
    without touching real tmux/registry state."""
    agent = _make_agent()

    async def fake_get_agent(identifier):
        return agent if identifier == agent.id else None

    monkeypatch.setattr(agent_manager, "get_agent", fake_get_agent)
    return agent


def test_send_message_success_stores_and_broadcasts(client, registered_agent, monkeypatch):
    async def fake_send_input(window, text, session=None):
        return None  # success

    monkeypatch.setattr(tmux_service, "send_input", fake_send_input)

    resp = client.post("/api/agents/worker-1/message", json={"content": "hello there"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["mention_routed_to"] == []
    assert body["mention_errors"] == []

    # Message must actually be in chat history now that delivery succeeded.
    history = conversation_store.get_messages(limit=50)
    contents = [m.content for m in history]
    assert "hello there" in contents


def test_send_message_delivery_failure_returns_503_and_does_not_store(client, registered_agent, monkeypatch):
    """The core bug fix: a genuine tmux delivery failure (agent asleep,
    crashed, window gone) must surface as an error, not a silent 200, and
    must NOT create a chat-history entry that would make it look like the
    message was actually delivered."""

    async def fake_send_input(window, text, session=None):
        raise TmuxDeliveryError("window 'soren:worker-1' does not exist (agent not spawned, asleep, or crashed)")

    monkeypatch.setattr(tmux_service, "send_input", fake_send_input)

    resp = client.post("/api/agents/worker-1/message", json={"content": "are you there?"})
    assert resp.status_code == 503
    assert "does not exist" in resp.json()["detail"]

    # Must NOT appear in chat history — it was never actually delivered.
    history = conversation_store.get_messages(limit=50)
    contents = [m.content for m in history]
    assert "are you there?" not in contents


def test_send_message_to_nonexistent_agent_returns_404(client):
    resp = client.post("/api/agents/totally-unknown-agent/message", json={"content": "hi"})
    assert resp.status_code == 404


def test_mention_to_unknown_agent_reported_as_error_not_silently_dropped(client, registered_agent, monkeypatch):
    """An @mention referencing a name that doesn't resolve to any known
    agent must be reported back in mention_errors, not silently absent
    with no indication of why it wasn't routed."""

    async def fake_send_input(window, text, session=None):
        return None

    monkeypatch.setattr(tmux_service, "send_input", fake_send_input)

    resp = client.post(
        "/api/agents/worker-1/message",
        json={"content": "hey @totally-nonexistent-agent can you help?"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["mention_routed_to"] == []
    assert len(body["mention_errors"]) == 1
    assert body["mention_errors"][0]["name"] == "totally-nonexistent-agent"
    assert body["mention_errors"][0]["reason"] == "not_found"


def test_mention_delivery_failure_reported_separately_from_primary_success(client, registered_agent, monkeypatch):
    """If the primary send succeeds but a mentioned agent's window is
    dead, the primary success must not be masked, and the mention failure
    must be reported with its specific reason."""
    mentioned = _make_agent(agent_id="worker-2")

    async def fake_get_agent(identifier):
        if identifier == registered_agent.id:
            return registered_agent
        if identifier == mentioned.id:
            return mentioned
        return None

    monkeypatch.setattr(agent_manager, "get_agent", fake_get_agent)

    async def fake_send_input(window, text, session=None):
        if window == mentioned.tmux_window:
            raise TmuxDeliveryError("window 'soren:worker-2' does not exist")
        return None

    monkeypatch.setattr(tmux_service, "send_input", fake_send_input)

    resp = client.post(
        "/api/agents/worker-1/message",
        json={"content": "hey @worker-2 look at this"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True  # primary send succeeded
    assert body["mention_routed_to"] == []
    assert len(body["mention_errors"]) == 1
    assert body["mention_errors"][0]["name"] == "worker-2"
    assert body["mention_errors"][0]["reason"] == "delivery_failed"


def test_interrupt_success(client, registered_agent, monkeypatch):
    async def fake_send_interrupt(window, session=None):
        return None

    monkeypatch.setattr(tmux_service, "send_interrupt", fake_send_interrupt)

    resp = client.post("/api/agents/worker-1/interrupt")
    assert resp.status_code == 200
    assert resp.json() == {"success": True, "agent_id": "worker-1"}


def test_interrupt_delivery_failure_returns_503(client, registered_agent, monkeypatch):
    """Previously interrupt_agent ignored send_interrupt()'s result
    entirely and always returned {"success": true} — a user clicking
    "interrupt" on a dead agent had no idea nothing actually happened."""

    async def fake_send_interrupt(window, session=None):
        raise TmuxDeliveryError("window 'soren:worker-1' does not exist")

    monkeypatch.setattr(tmux_service, "send_interrupt", fake_send_interrupt)

    resp = client.post("/api/agents/worker-1/interrupt")
    assert resp.status_code == 503
    assert "does not exist" in resp.json()["detail"]
