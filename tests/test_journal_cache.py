"""Tests for the _collect_all_entries() cache (routes/journal.py).

_collect_all_entries() re-reads and re-parses every journal .md file from
disk on every call, and is shared by 6 different routes (get_journal_stats,
get_recurring_issues [polled every 60s], get_weekly_summary,
get_issue_lifecycle, _compute_correction_compliance [polled every 120s],
get_compliance_trend). This tests the caching layer added on top, not the
parsing logic itself (already covered by tests/test_recurring_issues.py's
pure-function tests).

journal_service is a module-level singleton whose base_path resolves
relative to cwd at import time (not redirected by conftest.py's autouse
fixture the way mailbox/db paths are) -- monkeypatching base_path directly
onto the singleton is the safe way to isolate these tests from the real
.soren/journal/ directory.
"""
import asyncio

import pytest

import src.server.routes.journal as journal_routes
from src.server.services.journal import journal_service


@pytest.fixture(autouse=True)
def isolated_journal(tmp_path, monkeypatch):
    monkeypatch.setattr(journal_service, "base_path", tmp_path)
    journal_routes._invalidate_entries_cache()
    yield
    journal_routes._invalidate_entries_cache()


async def _write_entry(title: str, content: str = "content"):
    await journal_service.add_entry(title=title, content=content, project_id=None)


def test_first_call_reads_from_disk():
    asyncio.run(_write_entry("First entry"))
    entries = asyncio.run(journal_routes._collect_all_entries())
    assert len(entries) == 1
    assert entries[0]["title"] == "First entry"


def test_second_call_within_ttl_returns_cached_result_not_a_fresh_read():
    asyncio.run(_write_entry("Original entry"))
    first = asyncio.run(journal_routes._collect_all_entries())
    assert len(first) == 1

    # Write a second entry directly through the service, bypassing the
    # route (and therefore its cache-invalidation call) -- simulates any
    # writer other than add_journal_entry.
    asyncio.run(_write_entry("Second entry, written after caching"))

    second = asyncio.run(journal_routes._collect_all_entries())
    assert second is first, "expected the exact cached list, not a fresh parse"
    assert len(second) == 1


def test_cache_invalidated_immediately_by_add_journal_entry():
    asyncio.run(_write_entry("Original entry"))
    first = asyncio.run(journal_routes._collect_all_entries())
    assert len(first) == 1

    from src.server.models.journal import JournalEntryCreate

    asyncio.run(
        journal_routes.add_journal_entry(
            JournalEntryCreate(title="Added via the real route", content="x", project_id=None)
        )
    )

    second = asyncio.run(journal_routes._collect_all_entries())
    assert len(second) == 2, "add_journal_entry must invalidate the cache immediately"


def test_cache_refetches_after_ttl_expires():
    asyncio.run(_write_entry("Original entry"))
    first = asyncio.run(journal_routes._collect_all_entries())
    assert len(first) == 1

    asyncio.run(_write_entry("Second entry"))

    # Simulate TTL expiry by back-dating the cache timestamp rather than
    # sleeping in a test.
    journal_routes._entries_cache["computed_at"] -= (
        journal_routes._ENTRIES_CACHE_TTL_SECONDS + 1
    )

    second = asyncio.run(journal_routes._collect_all_entries())
    assert len(second) == 2, "expected a fresh read after TTL expiry"


def test_manual_invalidation_forces_a_fresh_read():
    asyncio.run(_write_entry("Original entry"))
    asyncio.run(journal_routes._collect_all_entries())

    asyncio.run(_write_entry("Second entry"))
    journal_routes._invalidate_entries_cache()

    result = asyncio.run(journal_routes._collect_all_entries())
    assert len(result) == 2
