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
