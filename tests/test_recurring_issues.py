"""Unit tests for recurring issues signal quality (AMBITION v12 P2).

Tests the filtering, tokenization, and clustering logic in journal.py
to ensure false positives are filtered and real issues pass through.
"""

import pytest
from src.server.routes.journal import (
    _word_set,
    _is_non_issue_title,
    _jaccard,
    STOP_TITLES,
)


# ── _word_set: min 2 chars per word ──────────────────────────────────────────


class TestWordSet:
    def test_basic(self):
        assert _word_set("OOM kill") == {"oom", "kill"}

    def test_filters_single_char(self):
        assert _word_set("a b cd ef") == {"cd", "ef"}

    def test_two_char_words_kept(self):
        ws = _word_set("Disk full")
        assert "disk" in ws
        assert "full" in ws

    def test_strips_markdown(self):
        ws = _word_set("## Test Results")
        assert "test" in ws
        assert "results" in ws

    def test_empty_string(self):
        assert _word_set("") == set()

    def test_single_word(self):
        assert _word_set("Test") == {"test"}


# ── _is_non_issue_title: negative filter ─────────────────────────────────────


class TestNonIssueFilter:
    """Known false positives should be filtered; real issues should pass."""

    # False positives that MUST be filtered
    def test_daily_report(self):
        assert _is_non_issue_title("Daily health digest") is True

    def test_version_marker(self):
        assert _is_non_issue_title("v10 AMBITION complete") is True

    def test_section_header_what(self):
        assert _is_non_issue_title("## What") is True

    def test_section_header_test(self):
        assert _is_non_issue_title("## Test") is True

    def test_section_header_commit(self):
        assert _is_non_issue_title("Commit details") is True

    def test_pure_completion_words(self):
        assert _is_non_issue_title("complete done shipped") is True

    def test_pure_status_words(self):
        assert _is_non_issue_title("initialized ready") is True

    # Real issues that MUST pass through
    def test_stale_lockfile(self):
        assert _is_non_issue_title("Stale lockfile preventing daemon start") is False

    def test_duplicate_monitor(self):
        assert _is_non_issue_title("Duplicate monitor process") is False

    def test_memory_injection_never_activated(self):
        assert _is_non_issue_title("Memory injection never activated") is False

    def test_oom_kill(self):
        assert _is_non_issue_title("OOM kill") is False

    def test_disk_full(self):
        assert _is_non_issue_title("Disk full") is False

    def test_pid_mismatch(self):
        assert _is_non_issue_title("PID mismatch on daemon restart") is False

    def test_websocket_timeout(self):
        assert _is_non_issue_title("WebSocket connection timeout") is False

    # Edge: completion word mixed with real content should NOT be filtered
    def test_mixed_completion_and_real(self):
        assert _is_non_issue_title("Fix complete but tests failing") is False

    def test_daily_in_middle(self):
        # Only filter if "daily" is at the START
        assert _is_non_issue_title("Fix daily cron job") is False


# ── STOP_TITLES: expanded set ────────────────────────────────────────────────


class TestStopTitles:
    def test_original_entries_present(self):
        assert 'what was done' in STOP_TITLES
        assert 'key decisions' in STOP_TITLES
        assert 'initialized' in STOP_TITLES

    def test_new_entries_present(self):
        assert 'summary' in STOP_TITLES
        assert 'task complete' in STOP_TITLES
        assert 'work complete' in STOP_TITLES


# ── _jaccard: similarity ─────────────────────────────────────────────────────


class TestJaccard:
    def test_identical(self):
        assert _jaccard({"a", "b"}, {"a", "b"}) == 1.0

    def test_disjoint(self):
        assert _jaccard({"a"}, {"b"}) == 0.0

    def test_empty(self):
        assert _jaccard(set(), {"a"}) == 0.0
        assert _jaccard({"a"}, set()) == 0.0

    def test_partial_overlap(self):
        assert _jaccard({"a", "b", "c"}, {"b", "c", "d"}) == pytest.approx(0.5)


# ── Recurring issues endpoint (integration) ──────────────────────────────────


@pytest.mark.asyncio
async def test_recurring_issues_endpoint_returns_200(async_client):
    """Smoke test: endpoint returns 200 and expected structure."""
    resp = await async_client.get("/api/journal/recurring-issues")
    assert resp.status_code == 200
    data = resp.json()
    assert "recurring_issues" in data
    assert "total_clusters" in data
    assert isinstance(data["recurring_issues"], list)
