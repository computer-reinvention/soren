"""Tests for the supervisor/team journal scoping restructure.

Journal storage is split into isolated scopes:
    .soren/journal/supervisor/<date>/journal.md + artifacts/
    .soren/journal/teams/<prefix>/<date>/journal.md + artifacts/

"supervisor" is the default (and the only scope that existed before this
change). Team scopes are strictly isolated from each other at the service
and route layer — there is no operation that reads/writes two team scopes
at once, and no agent-facing capability to browse another team's journal.
Aggregation across scopes exists only for supervisor/dashboard-level
oversight (_collect_all_entries() and the team= filter on the six
intelligence endpoints), not for lateral team-to-team access.

journal_service is a module-level singleton whose base_path resolves
relative to cwd at import time — monkeypatching base_path directly onto
the singleton (as test_journal_cache.py already does) is how these tests
stay isolated from the real .soren/journal/.
"""
import asyncio

import pytest
from fastapi.testclient import TestClient

import src.server.routes.journal as journal_routes
from src.server.services.journal import journal_service
from src.server.main import app


@pytest.fixture(autouse=True)
def isolated_journal(tmp_path, monkeypatch):
    monkeypatch.setattr(journal_service, "base_path", tmp_path)
    journal_routes._invalidate_entries_cache()
    yield
    journal_routes._invalidate_entries_cache()


@pytest.fixture
def client():
    return TestClient(app)


# ── Service-level scope resolution ──────────────────────────────────────────


def test_add_entry_defaults_to_supervisor_scope(tmp_path):
    asyncio.run(journal_service.add_entry(title="hello", content="world"))
    assert (tmp_path / "supervisor").exists()
    assert not (tmp_path / "teams").exists()


def test_add_entry_with_team_scope_writes_under_teams_prefix(tmp_path):
    asyncio.run(journal_service.add_entry(title="hello", content="world", scope="team", team="trie"))
    assert (tmp_path / "teams" / "trie").exists()
    assert not (tmp_path / "supervisor").exists()


def test_team_scope_without_team_name_raises():
    with pytest.raises(ValueError):
        asyncio.run(journal_service.add_entry(title="x", content="y", scope="team", team=None))


def test_unknown_scope_raises():
    with pytest.raises(ValueError):
        asyncio.run(journal_service.add_entry(title="x", content="y", scope="bogus"))


def test_two_teams_write_to_separate_files(tmp_path):
    asyncio.run(journal_service.add_entry(title="trie work", content="", scope="team", team="trie"))
    asyncio.run(journal_service.add_entry(title="dash work", content="", scope="team", team="dash"))

    trie_dates = asyncio.run(journal_service.list_dates(scope="team", team="trie"))
    dash_dates = asyncio.run(journal_service.list_dates(scope="team", team="dash"))
    assert len(trie_dates) == 1
    assert len(dash_dates) == 1

    trie_day = asyncio.run(journal_service.get_day(
        __import__("datetime").date.fromisoformat(trie_dates[0]), scope="team", team="trie"
    ))
    assert "trie work" in trie_day.content
    assert "dash work" not in trie_day.content


def test_search_within_one_team_does_not_leak_into_another(tmp_path):
    asyncio.run(journal_service.add_entry(title="unique-marker-alpha", content="", scope="team", team="trie"))
    asyncio.run(journal_service.add_entry(title="unique-marker-alpha", content="", scope="team", team="dash"))

    trie_results = asyncio.run(journal_service.search(query="unique-marker-alpha", scope="team", team="trie"))
    assert len(trie_results) == 1

    # Searching dash's scope finds its own copy, not trie's.
    dash_results = asyncio.run(journal_service.search(query="unique-marker-alpha", scope="team", team="dash"))
    assert len(dash_results) == 1


def test_list_teams_returns_only_teams_with_a_journal_dir(tmp_path):
    asyncio.run(journal_service.add_entry(title="x", content="", scope="team", team="trie"))
    asyncio.run(journal_service.add_entry(title="y", content="", scope="team", team="dash"))
    teams = asyncio.run(journal_service.list_teams())
    assert teams == ["dash", "trie"]


def test_list_teams_empty_when_no_teams_directory(tmp_path):
    assert asyncio.run(journal_service.list_teams()) == []


def test_tags_recorded_as_visible_line_not_silently_dropped():
    entry = asyncio.run(journal_service.add_entry(
        title="tagged entry", content="body text", tags=["automated", "digest"]
    ))
    day = asyncio.run(journal_service.get_day(entry.timestamp.date()))
    assert "**Tags:** automated, digest" in day.content
    assert "body text" in day.content


def test_tags_with_no_content_still_recorded():
    entry = asyncio.run(journal_service.add_entry(title="tagged only", content="", tags=["x"]))
    day = asyncio.run(journal_service.get_day(entry.timestamp.date()))
    assert "**Tags:** x" in day.content


def test_save_and_get_artifact_respects_team_scope(tmp_path):
    asyncio.run(journal_service.save_artifact(
        filename="plan.md", content=b"team plan", scope="team", team="trie"
    ))
    from datetime import date
    today = date.today()
    got = asyncio.run(journal_service.get_artifact("plan.md", today, scope="team", team="trie"))
    assert got == b"team plan"

    # Not visible from the supervisor scope.
    got_supervisor = asyncio.run(journal_service.get_artifact("plan.md", today, scope="supervisor"))
    assert got_supervisor is None


# ── Route-level validation ───────────────────────────────────────────────────


def test_post_entry_defaults_to_supervisor(client):
    res = client.post("/api/journal/entry", json={"title": "t", "content": "c"})
    assert res.status_code == 200
    body = res.json()
    assert body["entry"]["scope"] == "supervisor"
    assert body["entry"]["team"] is None


def test_post_entry_team_scope_requires_team_field(client):
    res = client.post("/api/journal/entry", json={"title": "t", "content": "c", "scope": "team"})
    assert res.status_code == 400


def test_post_entry_invalid_scope_rejected(client):
    res = client.post("/api/journal/entry", json={"title": "t", "content": "c", "scope": "bogus"})
    assert res.status_code == 400


def test_post_entry_team_scope_succeeds_with_team(client):
    res = client.post(
        "/api/journal/entry",
        json={"title": "t", "content": "c", "scope": "team", "team": "trie"},
    )
    assert res.status_code == 200
    assert res.json()["entry"]["team"] == "trie"


def test_get_journal_team_scope_requires_team(client):
    res = client.get("/api/journal", params={"scope": "team"})
    assert res.status_code == 400


def test_get_journal_dates_team_scope_requires_team(client):
    res = client.get("/api/journal/dates", params={"scope": "team"})
    assert res.status_code == 400


def test_tags_field_accepted_by_request_model_not_dropped(client):
    """Regression: JournalEntryCreate previously had no `tags` field, so
    pydantic silently discarded it even though real callers (monitor.sh's
    daily digest, AGENTS.md's own supervisor-journaling snippet) sent it."""
    res = client.post(
        "/api/journal/entry",
        json={"title": "digest", "content": "", "tags": ["digest", "automated"]},
    )
    assert res.status_code == 200

    day = client.get("/api/journal").json()
    assert "**Tags:** digest, automated" in day["content"]


# ── Cross-scope isolation via the API ───────────────────────────────────────


def test_search_default_scope_does_not_cross_into_a_team(client):
    client.post("/api/journal/entry", json={"title": "supervisor-only-marker", "content": ""})
    client.post(
        "/api/journal/entry",
        json={"title": "team-only-marker", "content": "", "scope": "team", "team": "trie"},
    )

    # Default search (scope=supervisor) must not surface the team's entry.
    res = client.get("/api/journal/search", params={"q": "team-only-marker"})
    assert res.json()["total"] == 0

    res = client.get("/api/journal/search", params={"q": "supervisor-only-marker"})
    assert res.json()["total"] == 1


def test_search_all_true_aggregates_across_scopes(client):
    client.post("/api/journal/entry", json={"title": "cross-scope-marker", "content": ""})
    client.post(
        "/api/journal/entry",
        json={"title": "cross-scope-marker", "content": "", "scope": "team", "team": "trie"},
    )

    res = client.get("/api/journal/search", params={"q": "cross-scope-marker", "all": "true"})
    assert res.json()["total"] == 2


def test_list_journal_teams_endpoint(client):
    client.post(
        "/api/journal/entry",
        json={"title": "x", "content": "", "scope": "team", "team": "trie"},
    )
    res = client.get("/api/journal/teams")
    assert res.status_code == 200
    assert res.json() == {"teams": ["trie"]}


# ── Intelligence endpoints: aggregate by default, filterable by team ───────


def test_stats_aggregates_supervisor_and_team_entries_by_default(client):
    client.post("/api/journal/entry", json={"title": "unique-stats-a some words", "content": ""})
    client.post(
        "/api/journal/entry",
        json={"title": "unique-stats-b other words", "content": "", "scope": "team", "team": "trie"},
    )
    res = client.get("/api/journal/stats")
    assert res.json()["total_entries"] == 2


def test_stats_team_filter_narrows_to_one_team(client):
    client.post("/api/journal/entry", json={"title": "supervisor entry here", "content": ""})
    client.post(
        "/api/journal/entry",
        json={"title": "trie entry here", "content": "", "scope": "team", "team": "trie"},
    )
    client.post(
        "/api/journal/entry",
        json={"title": "dash entry here", "content": "", "scope": "team", "team": "dash"},
    )

    res = client.get("/api/journal/stats", params={"team": "trie"})
    assert res.json()["total_entries"] == 1


def test_recurring_issues_team_filter(client):
    import datetime
    from src.server.services.journal import journal_service as js

    d1 = datetime.date(2026, 1, 1)
    d2 = datetime.date(2026, 1, 2)
    asyncio.run(js.add_entry(title="Recurring auth token bug found", content="", journal_date=d1, scope="team", team="trie"))
    asyncio.run(js.add_entry(title="Recurring auth token bug found", content="", journal_date=d2, scope="team", team="trie"))
    journal_routes._invalidate_entries_cache()

    res = client.get("/api/journal/recurring-issues", params={"team": "trie"})
    assert res.json()["total_clusters"] == 1

    res_other = client.get("/api/journal/recurring-issues", params={"team": "dash"})
    assert res_other.json()["total_clusters"] == 0
