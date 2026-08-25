"""Regression coverage for the failure_log service and its /api/agents/failures route.

This table was always empty in production until the P5.3 reliability dashboard
started actually reading it, which is how get_failure_stats()'s "recent" query
was found to crash with IndexError: No item with that key — the SELECT omitted
the root_cause column while the row-building code below it read r["root_cause"].
"""
from src.server.services import failure_log as failure_log_svc


def test_get_failure_stats_empty(client):
    response = client.get("/api/agents/failures")
    assert response.status_code == 200
    assert response.json() == {"total": 0, "by_type": {}, "by_agent": {}, "recent": []}


def test_log_failure_and_get_stats(client):
    failure_log_svc.log_failure(
        agent_id="perm-backend",
        failure_type="build_error",
        description="tsc failed",
        commit_sha="abc1234",
        root_cause='{"cause": "missing import"}',
    )
    failure_log_svc.log_failure(
        agent_id="perm-backend",
        failure_type="test_failure",
        description="pytest failed",
    )
    failure_log_svc.log_failure(
        agent_id="perm-frontend",
        failure_type="build_error",
        description="vite build failed",
    )

    response = client.get("/api/agents/failures")
    assert response.status_code == 200
    body = response.json()

    assert body["total"] == 3
    assert body["by_type"] == {"build_error": 2, "test_failure": 1}
    assert body["by_agent"]["perm-backend"]["total"] == 2
    assert body["by_agent"]["perm-frontend"]["total"] == 1

    # "recent" is where the missing-column bug lived — every field, including
    # the nullable ones, must round-trip without raising.
    assert len(body["recent"]) == 3
    by_description = {r["description"]: r for r in body["recent"]}
    build_error_row = by_description["tsc failed"]
    assert build_error_row["commit_sha"] == "abc1234"
    assert build_error_row["resolved"] is False
    assert build_error_row["root_cause"] == '{"cause": "missing import"}'

    # log_failure() doesn't set commit_sha/root_cause -> must come back as
    # null, not raise, and not silently default to some other value.
    no_extras_row = by_description["pytest failed"]
    assert no_extras_row["commit_sha"] is None
    assert no_extras_row["root_cause"] is None


def test_log_failure_post_endpoint_and_validation(client):
    response = client.post(
        "/api/agents/failures",
        json={
            "agent_id": "perm-backend",
            "failure_type": "timeout",
            "description": "task exceeded budget",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert isinstance(body["id"], int)

    bad_response = client.post(
        "/api/agents/failures",
        json={
            "agent_id": "perm-backend",
            "failure_type": "not_a_real_type",
            "description": "x",
        },
    )
    assert bad_response.status_code == 422
