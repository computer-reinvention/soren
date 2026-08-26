"""Tests for heartbeat_history retention (routes/heartbeat.py).

heartbeat_history had no natural bound: monitor.sh posts a heartbeat
roughly every 5s and nothing ever deleted from the table -- measured live
at 44,700 rows / 57% of the entire consolidated database. prune_old_
heartbeats() (called periodically by main.py's background task) is the
fix.
"""
import time

from src.server.routes import heartbeat as heartbeat_module


def _insert_heartbeat(age_days: float, all_clear: bool = True):
    ts = time.time() - age_days * 86400
    with heartbeat_module._get_connection() as conn:
        conn.execute(
            """INSERT INTO heartbeat_history
               (timestamp, sections, highest_priority, all_clear, received_at)
               VALUES (?, ?, ?, ?, ?)""",
            (ts, "{}", None, all_clear, "2026-01-01T00:00:00+00:00"),
        )


def _count_heartbeats() -> int:
    with heartbeat_module._get_connection() as conn:
        return conn.execute("SELECT COUNT(*) FROM heartbeat_history").fetchone()[0]


def test_prune_deletes_rows_older_than_retention_window():
    _insert_heartbeat(age_days=20)  # older than default 14-day retention
    _insert_heartbeat(age_days=1)   # recent, must survive

    deleted = heartbeat_module.prune_old_heartbeats(retention_days=14)

    assert deleted == 1
    assert _count_heartbeats() == 1


def test_prune_keeps_everything_within_the_window():
    _insert_heartbeat(age_days=1)
    _insert_heartbeat(age_days=5)
    _insert_heartbeat(age_days=13)

    deleted = heartbeat_module.prune_old_heartbeats(retention_days=14)

    assert deleted == 0
    assert _count_heartbeats() == 3


def test_prune_respects_custom_retention_days():
    _insert_heartbeat(age_days=3)
    _insert_heartbeat(age_days=10)

    deleted = heartbeat_module.prune_old_heartbeats(retention_days=5)

    assert deleted == 1
    assert _count_heartbeats() == 1


def test_prune_uses_settings_default_when_not_specified(monkeypatch):
    from src.server.config import settings

    monkeypatch.setattr(settings, "heartbeat_retention_days", 2)
    _insert_heartbeat(age_days=1)
    _insert_heartbeat(age_days=3)

    deleted = heartbeat_module.prune_old_heartbeats()

    assert deleted == 1
    assert _count_heartbeats() == 1


def test_prune_is_a_noop_on_an_empty_table():
    assert heartbeat_module.prune_old_heartbeats() == 0


def test_timestamp_index_exists():
    """The DELETE ... WHERE timestamp < ? pruning query needs this index
    to avoid a full table scan every time it runs -- there was no index
    of any kind on heartbeat_history before."""
    with heartbeat_module._get_connection() as conn:
        indexes = conn.execute(
            "PRAGMA index_list(heartbeat_history)"
        ).fetchall()
    index_names = {row["name"] for row in indexes}
    assert "idx_heartbeat_timestamp" in index_names
