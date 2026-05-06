"""Smoke tests for observability endpoints: quality metrics, duration, budget."""

import uuid

import pytest

from src.server.models.message import Message, MessageType, TaskStatus
from src.server.services.conversation_store import conversation_store


def _insert_message(to_agent: str, task_status: str):
    """Insert a message directly into the conversation store."""
    msg = Message(
        id=str(uuid.uuid4()),
        from_agent="supervisor",
        to_agent=to_agent,
        type=MessageType.TASK,
        content="test message",
        task_status=TaskStatus(task_status),
    )
    conversation_store.store_message(msg)


# ── Quality metrics: noise exclusion ──────────────────────────────────────────


def test_quality_metrics_excludes_noise(client):
    """Messages to 'user' should not appear in quality metrics."""
    _insert_message("user", "completed")
    resp = client.get("/api/metrics/quality")
    assert resp.status_code == 200
    data = resp.json()
    agent_ids = [a["agent_id"] for a in data["agents"]]
    assert "user" not in agent_ids, "noise agent 'user' should be excluded"


def test_quality_metrics_includes_real_agents(client):
    """Messages to real agents like 'perm-backend' should appear."""
    _insert_message("perm-backend", "completed")
    resp = client.get("/api/metrics/quality")
    assert resp.status_code == 200
    data = resp.json()
    agent_ids = [a["agent_id"] for a in data["agents"]]
    assert "perm-backend" in agent_ids, "real agent should appear in quality metrics"


# ── Duration endpoint ─────────────────────────────────────────────────────────


def test_duration_endpoint_returns_data(client):
    """GET /api/metrics/quality/duration should return agents dict and overall_avg."""
    resp = client.get("/api/metrics/quality/duration")
    assert resp.status_code == 200
    data = resp.json()
    assert "agents" in data
    assert "overall_avg" in data


# ── Budget status ─────────────────────────────────────────────────────────────


def test_budget_status_returns_data(client):
    """GET /api/budget/status should return daily_spend_usd field."""
    resp = client.get("/api/budget/status")
    assert resp.status_code == 200
    data = resp.json()
    assert "daily_spend_usd" in data
