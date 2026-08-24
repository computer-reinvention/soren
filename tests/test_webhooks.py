import pytest


def test_webhook_health(client):
    response = client.get("/api/webhooks/health")
    # 200 when frontend is built, 503 when degraded (e.g. fresh clone, no dist/)
    assert response.status_code in (200, 503)
    body = response.json()
    assert body["api"] == "healthy"
    assert "frontend" in body
    assert "daemons" in body


def test_receive_webhook(client):
    payload = {
        "source": "github",
        "event_type": "push",
        "data": {"ref": "refs/heads/main"}
    }
    response = client.post("/api/webhooks/github", json=payload)
    assert response.status_code == 200
    assert response.json()["success"] is True
    assert "message_id" in response.json()


def test_webhook_invalid_payload(client):
    response = client.post("/api/webhooks/test", json={})
    assert response.status_code == 422  # Validation error


def test_git_status(client):
    response = client.get("/api/webhooks/git-status")
    assert response.status_code == 200
    body = response.json()
    for key in (
        "branch", "sha", "ahead", "behind", "has_upstream",
        "uncommitted_count", "changed_files", "recent_commits",
    ):
        assert key in body
    assert isinstance(body["changed_files"], list)
    assert isinstance(body["recent_commits"], list)
    # Every changed file has a real path and a known status label
    for f in body["changed_files"]:
        assert f["path"]
        assert f["status"]
    # Commits, when present, carry sha/author/date/message
    for c in body["recent_commits"]:
        assert set(c.keys()) == {"sha", "author", "date", "message"}


def test_commit_diff_working_tree(client):
    response = client.get("/api/webhooks/commit-diff?sha=working")
    assert response.status_code == 200
    body = response.json()
    assert body["sha"] == "working"
    assert isinstance(body["files"], list)
    for f in body["files"]:
        assert set(f.keys()) == {"path", "status", "binary", "old_content", "new_content"}


def test_commit_diff_real_commit(client):
    # HEAD always exists in this repo's test environment.
    head_sha = __import__("subprocess").run(
        ["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True
    ).stdout.strip()
    response = client.get(f"/api/webhooks/commit-diff?sha={head_sha}")
    assert response.status_code == 200
    body = response.json()
    assert body["sha"] == head_sha
    assert body["title"]  # commit metadata line, non-empty
    assert isinstance(body["files"], list)


def test_commit_diff_rejects_unsafe_ref(client):
    response = client.get("/api/webhooks/commit-diff?sha=--upload-pack=x")
    assert response.status_code == 422


def test_commit_diff_unknown_commit(client):
    response = client.get("/api/webhooks/commit-diff?sha=0000000000000000000000000000000000000000")
    assert response.status_code == 404
