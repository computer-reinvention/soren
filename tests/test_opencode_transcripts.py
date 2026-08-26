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
