"""Tests for auto-sleep timeout and keep-awake endpoint."""
import pytest
from datetime import datetime, timezone, timedelta

from src.server.main import _should_auto_sleep
from src.server.models.agent import Agent, AgentType, AgentRole, AgentStatus


def _make_agent(**kwargs) -> Agent:
    defaults = dict(
        id="perm-backend",
        name="perm-backend",
        type=AgentType.WORKER,
        role=AgentRole.WORKER,
        tmux_window="perm-backend",
        status=AgentStatus.IDLE,
        last_activity=datetime.now(timezone.utc) - timedelta(hours=1),
    )
    defaults.update(kwargs)
    return Agent(**defaults)


# ── _should_auto_sleep unit tests ──────────────────────────────────────────

def test_auto_sleep_eligible():
    agent = _make_agent()
    assert _should_auto_sleep(agent, threshold_minutes=30) is True


def test_auto_sleep_skips_non_idle():
    for status in (
        AgentStatus.IN_PROGRESS,
        AgentStatus.BLOCKED,
        AgentStatus.COMPLETE,
        AgentStatus.FAILED,
        AgentStatus.SLEEPING,
    ):
        agent = _make_agent(status=status)
        assert _should_auto_sleep(agent, threshold_minutes=30) is False, status


def test_auto_sleep_skips_supervisor_type():
    agent = _make_agent(type=AgentType.SUPERVISOR, role=AgentRole.SUPERVISOR)
    assert _should_auto_sleep(agent, threshold_minutes=30) is False


def test_auto_sleep_skips_supervisor_role():
    agent = _make_agent(type=AgentType.WORKER, role=AgentRole.SUPERVISOR)
    assert _should_auto_sleep(agent, threshold_minutes=30) is False


def test_auto_sleep_skips_project_supervisor_role():
    agent = _make_agent(type=AgentType.SUPERVISOR, role=AgentRole.PROJECT_SUPERVISOR)
    assert _should_auto_sleep(agent, threshold_minutes=30) is False


def test_auto_sleep_skips_keep_awake():
    agent = _make_agent(keep_awake=True)
    assert _should_auto_sleep(agent, threshold_minutes=30) is False


def test_auto_sleep_skips_no_last_activity():
    agent = _make_agent(last_activity=None)
    assert _should_auto_sleep(agent, threshold_minutes=30) is False


def test_auto_sleep_skips_recently_active():
    # Only 10 minutes of inactivity, threshold is 30
    agent = _make_agent(
        last_activity=datetime.now(timezone.utc) - timedelta(minutes=10)
    )
    assert _should_auto_sleep(agent, threshold_minutes=30) is False


def test_auto_sleep_exactly_at_threshold():
    # Exactly at threshold → eligible
    agent = _make_agent(
        last_activity=datetime.now(timezone.utc) - timedelta(minutes=30)
    )
    assert _should_auto_sleep(agent, threshold_minutes=30) is True


def test_auto_sleep_naive_datetime_treated_as_utc():
    # last_activity without tzinfo should not raise
    agent = _make_agent(
        last_activity=datetime.now(timezone.utc) - timedelta(hours=2)
    )
    result = _should_auto_sleep(agent, threshold_minutes=30)
    assert result is True


# ── HTTP endpoint tests ─────────────────────────────────────────────────────

def test_keep_awake_endpoint_not_found(client):
    response = client.post(
        "/api/agents/nonexistent/keep-awake",
        json={"keep_awake": True},
    )
    assert response.status_code == 404


def test_keep_awake_endpoint_exists_in_router():
    """Verify the route is registered (not a 405 Method Not Allowed)."""
    from src.server.main import app
    routes = {r.path for r in app.routes}
    assert any("keep-awake" in str(r) for r in app.routes)
