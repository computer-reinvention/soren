import pytest


def test_get_budget_summary_empty(client):
    """Test budget summary returns empty list when no usage data exists."""
    response = client.get("/api/budget")
    assert response.status_code == 200
    data = response.json()
    assert "agents" in data
    assert isinstance(data["agents"], list)


def test_get_budget_summary_with_usage(client):
    """Test budget summary uses the LATEST event per agent (cumulative semantics).

    Usage values in agent_events are cumulative session totals — each Stop event
    reports the running total for that session, not a delta.  The budget summary
    must therefore use only the most-recent event per agent, not SUM them.
    """
    # First event — session running total after turn 1
    client.post("/api/agent-events", json={
        "event_type": "Stop",
        "session_id": "sess-bg-1",
        "agent_id": "budget-agent-a",
        "usage": {
            "input_tokens": 1000,
            "output_tokens": 200,
            "cache_read_input_tokens": 50,
            "cache_creation_input_tokens": 100,
        },
    })
    # Second event — session running total after turn 2 (higher, as expected for cumulative)
    client.post("/api/agent-events", json={
        "event_type": "Stop",
        "session_id": "sess-bg-1",
        "agent_id": "budget-agent-a",
        "usage": {
            "input_tokens": 1500,
            "output_tokens": 350,
            "cache_read_input_tokens": 75,
            "cache_creation_input_tokens": 100,
        },
    })

    response = client.get("/api/budget")
    assert response.status_code == 200
    data = response.json()
    # Find our agent in the results
    agent_data = [a for a in data["agents"] if a["agent_id"] == "budget-agent-a"]
    assert len(agent_data) >= 1
    agent = agent_data[0]
    # Should equal the LATEST event's values — not the sum (3000/700/150/200)
    assert agent["input_tokens"] == 1500
    assert agent["output_tokens"] == 350
    assert agent["cache_read_tokens"] == 75
    assert agent["cache_creation_tokens"] == 100
    assert agent["event_count"] >= 2


def test_get_agent_budget_detail(client):
    """Test single agent budget returns totals and recent events."""
    # Post an event with usage
    client.post("/api/agent-events", json={
        "event_type": "Stop",
        "session_id": "sess-bg-2",
        "agent_id": "budget-agent-b",
        "usage": {
            "input_tokens": 800,
            "output_tokens": 300,
            "cache_read_input_tokens": 40,
            "cache_creation_input_tokens": 60,
        },
    })

    response = client.get("/api/budget/budget-agent-b")
    assert response.status_code == 200
    data = response.json()
    assert "totals" in data
    assert "recent_events" in data
    assert data["totals"]["agent_id"] == "budget-agent-b"
    assert data["totals"]["input_tokens"] >= 800
    assert data["totals"]["output_tokens"] >= 300
    assert len(data["recent_events"]) >= 1
    # Verify events include usage
    for evt in data["recent_events"]:
        assert evt["usage"] is not None


def test_get_agent_budget_no_data(client):
    """Test single agent budget returns zeros when no usage data exists."""
    response = client.get("/api/budget/nonexistent-agent")
    assert response.status_code == 200
    data = response.json()
    assert data["totals"]["input_tokens"] == 0
    assert data["totals"]["output_tokens"] == 0
    assert data["totals"]["event_count"] == 0
    assert data["recent_events"] == []


def _make_fake_opencode_db(path, sessions):
    """sessions: list of (id, cost, tokens_input, tokens_output,
    tokens_cache_read, tokens_cache_write)."""
    import sqlite3

    conn = sqlite3.connect(str(path))
    conn.execute(
        """
        CREATE TABLE session (
            id TEXT PRIMARY KEY, directory TEXT,
            cost REAL DEFAULT 0, tokens_input INTEGER DEFAULT 0,
            tokens_output INTEGER DEFAULT 0, tokens_cache_read INTEGER DEFAULT 0,
            tokens_cache_write INTEGER DEFAULT 0
        )
        """
    )
    conn.executemany(
        "INSERT INTO session (id, cost, tokens_input, tokens_output, "
        "tokens_cache_read, tokens_cache_write) VALUES (?, ?, ?, ?, ?, ?)",
        sessions,
    )
    conn.commit()
    conn.close()


def test_budget_summary_uses_real_cost_when_opencode_db_has_the_session(
    client, tmp_path, monkeypatch
):
    """The headline fix: cost must come from opencode's own real,
    already-priced number for a session it has a record of — not
    SOREN's own token-based estimate (which was priced for the wrong
    model and ran ~2.5x too high)."""
    fake_db = tmp_path / "opencode.db"
    monkeypatch.setenv("SOREN_OPENCODE_DB_PATH", str(fake_db))
    _make_fake_opencode_db(
        fake_db,
        sessions=[("sess-real-cost-1", 42.5, 1000, 2000, 3000, 4000)],
    )

    client.post("/api/agent-events", json={
        "event_type": "Stop",
        "session_id": "sess-real-cost-1",
        "agent_id": "budget-agent-real",
        "usage": {
            "input_tokens": 1000,
            "output_tokens": 2000,
            "cache_read_input_tokens": 3000,
            "cache_creation_input_tokens": 4000,
        },
    })

    response = client.get("/api/budget")
    assert response.status_code == 200
    agent = next(
        a for a in response.json()["agents"] if a["agent_id"] == "budget-agent-real"
    )
    # Real cost (42.5) must win, not the token-estimate formula's result
    # for these same counts (which would be a different number entirely
    # under the corrected pricing table, let alone the old wrong one).
    assert agent["cost_usd"] == 42.5


def test_budget_summary_falls_back_to_estimate_when_session_not_in_opencode_db(
    client, tmp_path, monkeypatch
):
    """A session opencode's own database has no record of (DB present but
    doesn't know this particular session — e.g. pruned, or from a
    different opencode installation) must still get a sane, non-zero
    cost via the token-estimate fallback rather than silently reporting
    zero."""
    fake_db = tmp_path / "opencode.db"
    monkeypatch.setenv("SOREN_OPENCODE_DB_PATH", str(fake_db))
    _make_fake_opencode_db(fake_db, sessions=[])  # DB exists, no sessions

    client.post("/api/agent-events", json={
        "event_type": "Stop",
        "session_id": "sess-no-real-data",
        "agent_id": "budget-agent-fallback",
        "usage": {
            "input_tokens": 1_000_000,
            "output_tokens": 1_000_000,
            "cache_read_input_tokens": 0,
            "cache_creation_input_tokens": 0,
        },
    })

    response = client.get("/api/budget")
    agent = next(
        a for a in response.json()["agents"]
        if a["agent_id"] == "budget-agent-fallback"
    )
    # Sonnet-5 fallback rates: $2/1M input + $10/1M output = $12 for 1M/1M.
    assert agent["cost_usd"] == pytest.approx(12.0)


def test_agent_budget_detail_uses_real_cost(client, tmp_path, monkeypatch):
    fake_db = tmp_path / "opencode.db"
    monkeypatch.setenv("SOREN_OPENCODE_DB_PATH", str(fake_db))
    _make_fake_opencode_db(
        fake_db, sessions=[("sess-detail-real", 7.25, 10, 20, 30, 40)]
    )

    client.post("/api/agent-events", json={
        "event_type": "Stop",
        "session_id": "sess-detail-real",
        "agent_id": "budget-agent-detail",
        "usage": {
            "input_tokens": 10,
            "output_tokens": 20,
            "cache_read_input_tokens": 30,
            "cache_creation_input_tokens": 40,
        },
    })

    response = client.get("/api/budget/budget-agent-detail")
    assert response.status_code == 200
    assert response.json()["totals"]["cost_usd"] == 7.25


def test_daily_budget_uses_real_cost_for_days_opencode_has_data_for(
    client, tmp_path, monkeypatch
):
    """GET /api/budget/daily must prefer opencode's own real per-day cost
    (summed from message-level data) over the token-based estimate for any
    day it actually has a record of."""
    import sqlite3
    import json as _json
    from datetime import date, datetime, timezone

    from src.server.services import budget_guard

    fake_db = tmp_path / "opencode.db"
    monkeypatch.setenv("SOREN_OPENCODE_DB_PATH", str(fake_db))
    project_dir = budget_guard.project_directory()

    conn = sqlite3.connect(str(fake_db))
    conn.execute(
        "CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT)"
    )
    conn.execute(
        "CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, "
        "time_created INTEGER, data TEXT)"
    )
    conn.execute("INSERT INTO session VALUES ('ses_daily', ?)", (project_dir,))
    today_ms = int(
        datetime.now(timezone.utc)
        .replace(hour=12, minute=0, second=0, microsecond=0)
        .timestamp()
        * 1000
    )
    conn.execute(
        "INSERT INTO message VALUES ('m1', 'ses_daily', ?, ?)",
        (today_ms, _json.dumps({"cost": 9.99})),
    )
    conn.commit()
    conn.close()

    # A SOREN-side event on the same day so get_daily_budget() has a row
    # for today at all (real cost overlays onto that day's entry).
    client.post("/api/agent-events", json={
        "event_type": "Stop",
        "session_id": "sess-daily-side",
        "agent_id": "budget-agent-daily",
        "usage": {"input_tokens": 1, "output_tokens": 1},
    })

    response = client.get("/api/budget/daily")
    assert response.status_code == 200
    today = date.today().isoformat()
    day = next(d for d in response.json()["days"] if d["date"] == today)
    assert day["cost_usd"] == 9.99


def test_event_without_usage_not_counted(client):
    """Test that events without usage field don't appear in budget."""
    # Post a PostToolUse event without usage
    client.post("/api/agent-events", json={
        "event_type": "PostToolUse",
        "session_id": "sess-bg-3",
        "agent_id": "budget-agent-c",
        "tool_name": "Bash",
    })

    response = client.get("/api/budget/budget-agent-c")
    assert response.status_code == 200
    data = response.json()
    assert data["totals"]["event_count"] == 0
    assert data["recent_events"] == []
