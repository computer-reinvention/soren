import json
from datetime import datetime, timedelta, timezone

import pytest

from src.server.config import settings


def test_list_agents(client):
    response = client.get("/api/agents")
    assert response.status_code == 200
    assert "agents" in response.json()
    assert "total" in response.json()


def test_get_nonexistent_agent(client):
    response = client.get("/api/agents/nonexistent")
    assert response.status_code == 404


def test_agent_reliability_empty(client):
    """No mailbox history at all -> empty agent list, not an error."""
    response = client.get("/api/agents/reliability")
    assert response.status_code == 200
    assert response.json() == {"agents": []}


def test_agent_reliability_counts_and_history(client):
    """Verifies aggregate counts and the per-day sparkline history bucketing."""
    today = datetime.now(timezone.utc).date()
    yesterday = today - timedelta(days=1)
    two_weeks_ago = today - timedelta(days=20)  # outside the 14-day window

    lines = [
        {"id": "1", "ts": f"{today.isoformat()}T10:00:00+00:00", "from": "soren:perm-backend", "subject": "[DONE] [VERIFIED] did a thing"},
        {"id": "2", "ts": f"{today.isoformat()}T11:00:00+00:00", "from": "soren:perm-backend", "subject": "[VERIFY-FAILED] missing-commit"},
        {"id": "3", "ts": f"{yesterday.isoformat()}T09:00:00+00:00", "from": "soren:perm-backend", "subject": "[DONE] [VERIFIED] another thing"},
        {"id": "4", "ts": f"{two_weeks_ago.isoformat()}T09:00:00+00:00", "from": "soren:perm-backend", "subject": "[DONE] [VERIFIED] old thing"},
        {"id": "5", "ts": f"{today.isoformat()}T12:00:00+00:00", "from": "soren:perm-frontend", "subject": "[DONE] [VERIFIED] frontend thing"},
        {"id": "6", "ts": f"{today.isoformat()}T12:05:00+00:00", "from": "soren:perm-frontend", "subject": "not a verification message"},
    ]
    settings.mailbox_path.write_text("\n".join(json.dumps(line) for line in lines) + "\n")

    response = client.get("/api/agents/reliability")
    assert response.status_code == 200
    body = response.json()
    agents = {a["agent_id"]: a for a in body["agents"]}

    assert set(agents.keys()) == {"perm-backend", "perm-frontend"}

    backend = agents["perm-backend"]
    # 3 verified total (today x1, yesterday x1, 20-days-ago x1) + 1 failed today
    assert backend["verified"] == 3
    assert backend["failed"] == 1
    assert backend["success_rate"] == 0.75

    # History is a fixed 14-day contiguous window ending today, oldest first.
    history = backend["history"]
    assert len(history) == 14
    assert history[-1]["date"] == today.isoformat()
    assert history[-1] == {"date": today.isoformat(), "verified": 1, "failed": 1, "success_rate": 0.5}
    assert history[-2]["date"] == yesterday.isoformat()
    assert history[-2] == {"date": yesterday.isoformat(), "verified": 1, "failed": 0, "success_rate": 1.0}
    # The message from 20 days ago falls outside the window and contributes
    # nothing to any bucket, even though it's counted in the lifetime total.
    assert all(day["verified"] == 0 and day["failed"] == 0 for day in history[:-2])
    # Days with no activity report success_rate as null, not 0 — 0 would
    # misleadingly imply a failing day rather than a quiet one.
    assert history[0]["success_rate"] is None

    frontend = agents["perm-frontend"]
    assert frontend["verified"] == 1
    assert frontend["failed"] == 0
    assert frontend["success_rate"] == 1.0
