"""Tests for v8 Priority #1: new infrastructure endpoints.

Covers:
- POST /api/messages/verify-result (verified + failed)
- GET /api/journal/correction-compliance
- Auto-detect task_status in store_message ([DONE], [VERIFIED], [VERIFY-FAILED])
- GET /api/metrics/quality (first_pass_rate in summary)
"""

import pytest
from datetime import datetime, timezone

from src.server.models.message import Message, MessageType, TaskStatus
from src.server.services.conversation_store import conversation_store


# ---------------------------------------------------------------------------
# Test 1: verify-result endpoint
# ---------------------------------------------------------------------------


def test_verify_result_verified(client):
    """POST verify-result with result=verified stores task_status=verified."""
    resp = client.post("/api/messages/verify-result", json={
        "agent_id": "test-agent",
        "result": "verified",
        "commit_sha": "abc1234",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "stored"
    assert data["task_status"] == "verified"
    assert "id" in data


def test_verify_result_failed(client):
    """POST verify-result with result=verify-failed stores task_status=failed."""
    resp = client.post("/api/messages/verify-result", json={
        "agent_id": "test-agent",
        "result": "verify-failed",
        "commit_sha": "abc1234",
        "details": "pytest failed: 3 errors",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "stored"
    assert data["task_status"] == "failed"


def test_verify_result_content_includes_details(client):
    """Verify that commit_sha and details appear in stored message content."""
    resp = client.post("/api/messages/verify-result", json={
        "agent_id": "test-agent",
        "result": "verified",
        "commit_sha": "deadbeef",
        "details": "all green",
    })
    assert resp.status_code == 200
    msg_id = resp.json()["id"]

    # Retrieve via messages endpoint and check content
    msgs_resp = client.get("/api/messages?limit=50")
    messages = msgs_resp.json()["messages"]
    found = [m for m in messages if m["id"] == msg_id]
    assert found, "Stored message should be retrievable"
    assert "deadbeef" in found[0]["content"]
    assert "all green" in found[0]["content"]


# ---------------------------------------------------------------------------
# Test 2: correction-compliance endpoint
# ---------------------------------------------------------------------------


def test_correction_compliance_returns_structure(client):
    """GET correction-compliance returns expected top-level keys."""
    resp = client.get("/api/journal/correction-compliance")
    assert resp.status_code == 200
    data = resp.json()
    assert "corrections" in data
    assert "overall_compliance" in data
    assert "total_rules" in data
    assert isinstance(data["corrections"], list)
    assert 0 <= data["overall_compliance"] <= 1.0


def test_correction_compliance_rule_fields(client):
    """Each correction rule should have the expected fields."""
    resp = client.get("/api/journal/correction-compliance")
    assert resp.status_code == 200
    data = resp.json()
    for rule in data["corrections"]:
        assert "id" in rule
        assert "rule" in rule
        assert "compliance_rate" in rule
        assert 0 <= rule["compliance_rate"] <= 1.0


# ---------------------------------------------------------------------------
# Test 3: auto-detect task_status in store_message
# ---------------------------------------------------------------------------


def test_store_message_done_auto_status():
    """[DONE] messages should auto-set task_status to completed."""
    msg = Message(
        id="test-done-auto",
        timestamp=datetime.now(timezone.utc),
        from_agent="test-worker",
        to_agent="supervisor",
        type=MessageType.STATUS,
        content="[DONE] abc1234 — Task completed successfully",
    )
    conversation_store.store_message(msg)

    results = conversation_store.get_messages(limit=50, agent_id="test-worker")
    found = [m for m in results if m.id == "test-done-auto"]
    assert found, "Message should be stored"
    assert found[0].task_status == TaskStatus.COMPLETED


def test_store_message_verified_auto_status():
    """[VERIFIED] messages should auto-set task_status to verified."""
    msg = Message(
        id="test-verified-auto",
        timestamp=datetime.now(timezone.utc),
        from_agent="system",
        to_agent="test-worker",
        type=MessageType.STATUS,
        content="[VERIFIED] test: commit abc123 checks passed",
    )
    conversation_store.store_message(msg)

    results = conversation_store.get_messages(limit=50, agent_id="test-worker")
    found = [m for m in results if m.id == "test-verified-auto"]
    assert found, "Message should be stored"
    assert found[0].task_status == TaskStatus.VERIFIED


def test_store_message_verify_failed_auto_status():
    """[VERIFY-FAILED] messages should auto-set task_status to failed."""
    msg = Message(
        id="test-verifyfail-auto",
        timestamp=datetime.now(timezone.utc),
        from_agent="system",
        to_agent="test-worker",
        type=MessageType.STATUS,
        content="[VERIFY-FAILED] test: commit abc123 — pytest errors",
    )
    conversation_store.store_message(msg)

    results = conversation_store.get_messages(limit=50, agent_id="test-worker")
    found = [m for m in results if m.id == "test-verifyfail-auto"]
    assert found, "Message should be stored"
    assert found[0].task_status == TaskStatus.FAILED


def test_store_message_no_auto_status_for_plain():
    """Plain messages without status tags should have task_status=None."""
    msg = Message(
        id="test-plain-auto",
        timestamp=datetime.now(timezone.utc),
        from_agent="test-worker",
        to_agent="supervisor",
        type=MessageType.STATUS,
        content="[STATUS] Working on the feature",
    )
    conversation_store.store_message(msg)

    results = conversation_store.get_messages(limit=50, agent_id="test-worker")
    found = [m for m in results if m.id == "test-plain-auto"]
    assert found, "Message should be stored"
    assert found[0].task_status is None


def test_store_message_explicit_status_not_overridden():
    """Explicit task_status should not be overridden by auto-detect."""
    msg = Message(
        id="test-explicit-auto",
        timestamp=datetime.now(timezone.utc),
        from_agent="test-worker",
        to_agent="supervisor",
        type=MessageType.STATUS,
        content="[DONE] but supervisor set submitted",
        task_status=TaskStatus.SUBMITTED,
    )
    conversation_store.store_message(msg)

    results = conversation_store.get_messages(limit=50, agent_id="test-worker")
    found = [m for m in results if m.id == "test-explicit-auto"]
    assert found, "Message should be stored"
    assert found[0].task_status == TaskStatus.SUBMITTED


# ---------------------------------------------------------------------------
# Test 4: quality metrics — first_pass_rate
# ---------------------------------------------------------------------------


def test_quality_metrics_returns_structure(client):
    """GET /api/metrics/quality returns expected top-level keys."""
    resp = client.get("/api/metrics/quality")
    assert resp.status_code == 200
    data = resp.json()
    assert "agents" in data
    assert "summary" in data
    summary = data["summary"]
    assert "system_first_pass_rate" in summary
    assert "total_completions" in summary
    assert "total_failures" in summary


def test_quality_metrics_first_pass_rate_with_data(client):
    """first_pass_rate should be computable when verified messages exist."""
    # Seed a TASK assignment and then a verified result (no FIX-REQUEST in between)
    client.post("/api/messages/internal", json={
        "from_agent": "supervisor",
        "to_agent": "worker-fp-test",
        "content": "[TASK] Do something",
        "task_status": "submitted",
    })
    client.post("/api/messages/verify-result", json={
        "agent_id": "worker-fp-test",
        "result": "verified",
        "commit_sha": "aaa1111",
    })

    resp = client.get("/api/metrics/quality")
    assert resp.status_code == 200
    data = resp.json()
    # At minimum, worker-fp-test should appear in agents
    agent_ids = [a["agent_id"] for a in data["agents"]]
    assert "worker-fp-test" in agent_ids
    agent = next(a for a in data["agents"] if a["agent_id"] == "worker-fp-test")
    assert "first_pass_rate" in agent
