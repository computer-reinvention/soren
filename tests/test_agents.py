import pytest


def test_list_agents(client):
    response = client.get("/api/agents")
    assert response.status_code == 200
    assert "agents" in response.json()
    assert "total" in response.json()


def test_get_nonexistent_agent(client):
    response = client.get("/api/agents/nonexistent")
    assert response.status_code == 404
