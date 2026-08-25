def test_get_prefs_defaults(client):
    response = client.get("/api/prefs")
    assert response.status_code == 200
    body = response.json()
    assert body["heartbeat_warn_threshold"] == 900
    assert body["ui_density"] == "comfortable"


def test_update_ui_density(client):
    response = client.put("/api/prefs", json={"ui_density": "compact"})
    assert response.status_code == 200
    assert response.json()["ui_density"] == "compact"

    # Persists across requests, and other keys are untouched by a partial update.
    response = client.get("/api/prefs")
    body = response.json()
    assert body["ui_density"] == "compact"
    assert body["heartbeat_warn_threshold"] == 900


def test_update_ui_density_rejects_invalid_value(client):
    response = client.put("/api/prefs", json={"ui_density": "cozy"})
    assert response.status_code == 422

    # The rejected update must not have partially applied.
    response = client.get("/api/prefs")
    assert response.json()["ui_density"] == "comfortable"


def test_update_prefs_partial_update_only_changes_provided_fields(client):
    client.put("/api/prefs", json={"ui_density": "compact"})
    response = client.put("/api/prefs", json={"heartbeat_max_nudges": 5})
    assert response.status_code == 200
    body = response.json()
    assert body["heartbeat_max_nudges"] == 5
    assert body["ui_density"] == "compact"
