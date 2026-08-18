import json

import pytest
from httpx import AsyncClient, ASGITransport

from src.server.main import app
from src.server.routes import teams as teams_route


SAMPLE_TEAMS = {
    "teams": [
        {
            "prefix": "api-crew",
            "template": "feature",
            "task": "Build the API",
            "members": ["api-crew-lead", "api-crew-dev"],
            "project_id": "my-api",
            "created_at": "2026-08-01T00:00:00Z",
        },
        {
            "prefix": "core",
            "template": "maintenance",
            "task": "permanent team",
            "members": ["core-fixer"],
            "project_id": "",
            "permanent": True,
            "created_at": "2026-08-02T00:00:00Z",
        },
    ]
}


@pytest.fixture
def teams_file(tmp_path, monkeypatch):
    """Point the teams route at a temp teams.json (monkeypatched path resolution)."""
    path = tmp_path / "teams.json"
    monkeypatch.setattr(teams_route, "get_teams_file", lambda: path)
    return path


@pytest.fixture
def fake_registry(monkeypatch):
    """Stub agent_registry lookups so tests don't depend on live registry state."""
    entries = {
        "api-crew-lead": {
            "agent_id": "ag_lead0001",
            "status": "IN_PROGRESS",
            "display_name": "API Crew Lead",
            "role": "worker",
        },
        "core-fixer": {
            "agent_id": "ag_fixer001",
            "status": "IDLE",
            "display_name": "core-fixer",
            "role": "worker",
        },
    }
    monkeypatch.setattr(
        teams_route.agent_registry, "get_agent_metadata", lambda key: entries.get(key)
    )
    monkeypatch.setattr(
        teams_route.agent_registry, "find_by_display_name", lambda name: None
    )
    return entries


# ── GET /api/teams ────────────────────────────────────────────────────────────

async def test_list_teams_missing_file(async_client, teams_file):
    # File does not exist — should return empty list, not error
    response = await async_client.get("/api/teams")
    assert response.status_code == 200
    data = response.json()
    assert data == {"teams": [], "total": 0}


async def test_list_teams_empty_file(async_client, teams_file):
    teams_file.write_text(json.dumps({"teams": []}))
    response = await async_client.get("/api/teams")
    assert response.status_code == 200
    assert response.json() == {"teams": [], "total": 0}


async def test_list_teams_malformed_file(async_client, teams_file):
    teams_file.write_text("{not valid json")
    response = await async_client.get("/api/teams")
    assert response.status_code == 200
    assert response.json() == {"teams": [], "total": 0}


async def test_list_teams_returns_all(async_client, teams_file, fake_registry):
    teams_file.write_text(json.dumps(SAMPLE_TEAMS))
    response = await async_client.get("/api/teams")
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 2
    prefixes = [t["prefix"] for t in data["teams"]]
    assert prefixes == ["api-crew", "core"]
    # Original team fields preserved
    team = data["teams"][0]
    assert team["template"] == "feature"
    assert team["task"] == "Build the API"
    assert team["project_id"] == "my-api"
    assert team["created_at"] == "2026-08-01T00:00:00Z"


async def test_list_teams_enriches_members(async_client, teams_file, fake_registry):
    teams_file.write_text(json.dumps(SAMPLE_TEAMS))
    response = await async_client.get("/api/teams")
    assert response.status_code == 200
    members = response.json()["teams"][0]["members"]
    assert len(members) == 2

    lead = members[0]
    assert lead["name"] == "api-crew-lead"
    assert lead["in_registry"] is True
    assert lead["status"] == "IN_PROGRESS"
    assert lead["agent_id"] == "ag_lead0001"
    assert lead["display_name"] == "API Crew Lead"

    # Member not present in registry
    dev = members[1]
    assert dev["name"] == "api-crew-dev"
    assert dev["in_registry"] is False
    assert dev["status"] is None
    assert dev["agent_id"] is None


# ── GET /api/teams/{prefix} ───────────────────────────────────────────────────

async def test_get_team_by_prefix(async_client, teams_file, fake_registry):
    teams_file.write_text(json.dumps(SAMPLE_TEAMS))
    response = await async_client.get("/api/teams/core")
    assert response.status_code == 200
    team = response.json()
    assert team["prefix"] == "core"
    assert team["permanent"] is True
    assert team["members"][0]["name"] == "core-fixer"
    assert team["members"][0]["status"] == "IDLE"
    assert team["members"][0]["in_registry"] is True


async def test_get_team_not_found(async_client, teams_file):
    teams_file.write_text(json.dumps(SAMPLE_TEAMS))
    response = await async_client.get("/api/teams/nonexistent")
    assert response.status_code == 404


# ── Auth behaviour (matches /api/projects: requires authentication) ──────────

async def test_teams_requires_auth(teams_file):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        response = await ac.get("/api/teams")
    assert response.status_code == 401
