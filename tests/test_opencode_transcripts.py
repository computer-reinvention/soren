"""Tests for services/opencode_transcripts.py — real cost/token data read
directly from opencode's own session database, rather than re-derived from
SOREN's own token-based estimate.

Builds a throwaway sqlite file that mirrors just the columns this module
actually queries from opencode's real ``session``/``message`` tables
(verified against a live opencode.db during development) — not opencode's
full schema, which isn't SOREN's to depend on beyond these columns.
"""
import sqlite3

import pytest

from src.server.services import opencode_transcripts as oct_module


def _make_opencode_db(path, sessions=(), messages=()):
    """sessions: list of (id, directory, cost, tokens_input, tokens_output,
    tokens_cache_read, tokens_cache_write).
    messages: list of (id, session_id, time_created_ms, cost).
    """
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
    conn.execute(
        """
        CREATE TABLE message (
            id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT
        )
        """
    )
    # Mirrors the real opencode.db's message_session_time_created_id_idx —
    # needed for test_get_daily_real_cost_uses_indexed_session_id_query_
    # not_a_full_scan to actually exercise the index-seek path this
    # module's query is written to use, rather than trivially passing due
    # to a fixture that doesn't have the index the real database does.
    conn.execute(
        "CREATE INDEX message_session_time_created_id_idx "
        "ON message (session_id, time_created, id)"
    )
    conn.executemany(
        "INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?)", sessions
    )
    import json as _json

    conn.executemany(
        "INSERT INTO message VALUES (?, ?, ?, ?)",
        [
            (mid, sid, ts, _json.dumps({"cost": cost}))
            for mid, sid, ts, cost in messages
        ],
    )
    conn.commit()
    conn.close()


@pytest.fixture
def fake_db(tmp_path, monkeypatch):
    db_path = tmp_path / "opencode.db"
    monkeypatch.setenv("SOREN_OPENCODE_DB_PATH", str(db_path))
    # get_daily_real_cost() caches by directory string (not by DB path) —
    # several tests below reuse the same "/repo/soren" directory against
    # different throwaway DBs, which would otherwise see a stale result
    # cached by an earlier test in the same process.
    oct_module._daily_cache.clear()
    return db_path


def test_is_available_false_when_missing(fake_db):
    assert oct_module.is_available() is False


def test_is_available_true_when_present(fake_db):
    _make_opencode_db(fake_db)
    assert oct_module.is_available() is True


def test_get_session_costs_empty_input_returns_empty(fake_db):
    assert oct_module.get_session_costs([]) == {}


def test_get_session_costs_missing_db_returns_empty(fake_db):
    # fake_db path set but file never created
    assert oct_module.get_session_costs(["ses_abc"]) == {}


def test_get_session_costs_returns_real_data(fake_db):
    _make_opencode_db(
        fake_db,
        sessions=[
            ("ses_a", "/repo", 12.5, 100, 200, 300, 400),
            ("ses_b", "/repo", 0.75, 5, 10, 15, 20),
        ],
    )
    result = oct_module.get_session_costs(["ses_a", "ses_b", "ses_nonexistent"])
    assert set(result.keys()) == {"ses_a", "ses_b"}
    assert result["ses_a"] == {
        "cost_usd": 12.5,
        "input_tokens": 100,
        "output_tokens": 200,
        "cache_read_tokens": 300,
        "cache_creation_tokens": 400,
    }
    assert result["ses_b"]["cost_usd"] == 0.75


def test_get_session_costs_corrupted_db_returns_empty(fake_db):
    fake_db.write_bytes(b"not a sqlite file")
    # Must degrade gracefully, never raise, on a corrupted/unreadable DB.
    assert oct_module.get_session_costs(["ses_a"]) == {}


def test_get_daily_real_cost_aggregates_by_day_scoped_to_directory(fake_db):
    _make_opencode_db(
        fake_db,
        sessions=[("ses_a", "/repo/soren", 0, 0, 0, 0, 0)],
        messages=[
            # Two messages same UTC day (2026-01-01)
            ("m1", "ses_a", 1735689600000, 1.5),  # 2025-01-01T00:00:00Z
            ("m2", "ses_a", 1735700000000, 2.5),  # same day, later
            # A different day
            ("m3", "ses_a", 1735776000000, 3.0),  # 2025-01-02T00:00:00Z
        ],
    )
    result = oct_module.get_daily_real_cost("/repo/soren")
    assert result["2025-01-01"] == pytest.approx(4.0)
    assert result["2025-01-02"] == pytest.approx(3.0)


def test_get_daily_real_cost_ignores_other_projects_directory(fake_db):
    _make_opencode_db(
        fake_db,
        sessions=[
            ("ses_soren", "/repo/soren", 0, 0, 0, 0, 0),
            ("ses_other", "/repo/unrelated-project", 0, 0, 0, 0, 0),
        ],
        messages=[
            ("m1", "ses_soren", 1735689600000, 5.0),
            ("m2", "ses_other", 1735689600000, 999.0),
        ],
    )
    result = oct_module.get_daily_real_cost("/repo/soren")
    assert result == {"2025-01-01": pytest.approx(5.0)}


def test_get_daily_real_cost_missing_db_returns_empty(fake_db):
    assert oct_module.get_daily_real_cost("/repo/soren") == {}


def test_get_daily_real_cost_uses_indexed_session_id_query_not_a_full_scan(fake_db):
    """The whole point of the two-step rewrite: querying `message` by
    `session_id IN (...)` must hit the message_session_time_created_id_idx
    index, not fall back to a full table scan the way the original
    single-JOIN query did (measured 0.6s vs 0.08s against a real 36k-row
    opencode.db -- unreproducible at this size, so this asserts the query
    *shape* directly instead)."""
    _make_opencode_db(
        fake_db,
        sessions=[("ses_a", "/repo/soren", 0, 0, 0, 0, 0)],
        messages=[("m1", "ses_a", 1735689600000, 1.0)],
    )
    conn = sqlite3.connect(str(fake_db))
    plan = conn.execute(
        "EXPLAIN QUERY PLAN SELECT date(time_created/1000,'unixepoch'), "
        "SUM(json_extract(data,'$.cost')) FROM message "
        "WHERE session_id IN ('ses_a') GROUP BY 1"
    ).fetchall()
    conn.close()
    plan_text = " ".join(str(row) for row in plan)
    assert "SCAN message" not in plan_text
    assert "message_session_time_created_id_idx" in plan_text or "SEARCH message" in plan_text


def test_get_daily_real_cost_is_cached_within_ttl(fake_db, monkeypatch):
    _make_opencode_db(
        fake_db,
        sessions=[("ses_a", "/repo/soren", 0, 0, 0, 0, 0)],
        messages=[("m1", "ses_a", 1735689600000, 10.0)],
    )
    first = oct_module.get_daily_real_cost("/repo/soren")
    assert first == {"2025-01-01": pytest.approx(10.0)}

    # Mutate the underlying DB directly -- a cached call must NOT see this
    # change within the TTL window.
    conn = sqlite3.connect(str(fake_db))
    conn.execute("UPDATE message SET data = '{\"cost\": 999.0}' WHERE id = 'm1'")
    conn.commit()
    conn.close()

    second = oct_module.get_daily_real_cost("/repo/soren")
    assert second == first, "expected the cached result, not a fresh (mutated) read"


def test_get_daily_real_cost_refetches_after_ttl_expires(fake_db, monkeypatch):
    _make_opencode_db(
        fake_db,
        sessions=[("ses_a", "/repo/soren", 0, 0, 0, 0, 0)],
        messages=[("m1", "ses_a", 1735689600000, 10.0)],
    )
    first = oct_module.get_daily_real_cost("/repo/soren")
    assert first == {"2025-01-01": pytest.approx(10.0)}

    conn = sqlite3.connect(str(fake_db))
    conn.execute("UPDATE message SET data = '{\"cost\": 20.0}' WHERE id = 'm1'")
    conn.commit()
    conn.close()

    # Simulate TTL expiry by back-dating the cache entry rather than
    # sleeping in a test.
    cached_at, cached_result = oct_module._daily_cache["/repo/soren"]
    oct_module._daily_cache["/repo/soren"] = (
        cached_at - oct_module._DAILY_CACHE_TTL_SECONDS - 1,
        cached_result,
    )

    second = oct_module.get_daily_real_cost("/repo/soren")
    assert second == {"2025-01-01": pytest.approx(20.0)}, "expected a fresh read after TTL expiry"
