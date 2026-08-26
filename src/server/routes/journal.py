import asyncio
import json
import re
import subprocess
import time
import aiofiles
from collections import Counter, defaultdict
from pathlib import Path
from fastapi import APIRouter, HTTPException, UploadFile, File, Query
from fastapi.responses import Response
from datetime import date, datetime, timedelta
from typing import Optional

from ..models.journal import (
    JournalEntryCreate,
    JournalDayResponse,
    JournalDatesResponse,
    JournalSearchResponse,
)
from ..services.journal import journal_service

router = APIRouter()


@router.get("", response_model=JournalDayResponse)
async def get_journal(
    journal_date: Optional[str] = Query(None, alias="date", description="Date in YYYY-MM-DD format"),
    project: Optional[str] = Query(None, description="Filter entries by project ID"),
):
    """
    Get journal for a specific date.

    If no date is provided, returns today's journal.
    Optionally filter entries by project ID.
    """
    if journal_date:
        try:
            parsed_date = date.fromisoformat(journal_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")
    else:
        parsed_date = date.today()

    return await journal_service.get_day(parsed_date, project=project)


@router.post("/entry")
async def add_journal_entry(entry: JournalEntryCreate):
    """Add a new entry to today's journal."""
    created = await journal_service.add_entry(
        title=entry.title,
        content=entry.content,
        project_id=entry.project_id,
    )
    _invalidate_entries_cache()
    return {
        "success": True,
        "entry": {
            "title": created.title,
            "timestamp": created.timestamp.isoformat(),
            "project_id": created.project_id,
        },
    }


@router.get("/dates", response_model=JournalDatesResponse)
async def list_journal_dates():
    """List all dates that have journal entries."""
    dates = await journal_service.list_dates()
    return JournalDatesResponse(dates=dates)


@router.get("/search", response_model=JournalSearchResponse)
async def search_journals(
    q: str = Query(..., description="Search query"),
    limit: int = Query(20, ge=1, le=100),
    project: Optional[str] = Query(None, description="Filter results by project ID"),
):
    """Search across all journal entries, optionally filtered by project."""
    results = await journal_service.search(query=q, limit=limit, project=project)
    return JournalSearchResponse(
        query=q,
        results=results,
        total=len(results),
    )


@router.get("/tag-frequency")
async def get_tag_frequency():
    """Count project tags across all journal entries, sorted by frequency."""
    dates = await journal_service.list_dates()
    counts: Counter[str] = Counter()

    for date_str in dates:
        journal_date = date.fromisoformat(date_str)
        journal_file = journal_service._get_journal_file(journal_date)
        if not journal_file.exists():
            continue
        async with aiofiles.open(journal_file, "r") as f:
            async for line in f:
                if line.startswith("## "):
                    tag = journal_service._parse_project_id(line)
                    if tag:
                        counts[tag] += 1

    return dict(counts.most_common())


# ── Helpers for journal intelligence ──────────────────────────────────────────

# _collect_all_entries() re-reads and re-parses every journal .md file from
# disk on every call, and is called independently (no shared cache) by 6
# different routes: get_journal_stats, get_recurring_issues (polled every
# 60s by the dashboard), get_weekly_summary, get_issue_lifecycle,
# _compute_correction_compliance (polled every 120s), get_compliance_trend.
# Cheap only while the journal corpus is still small — this is a pure
# function of on-disk state with an obvious caching opportunity that
# wasn't taken. Invalidated immediately when a new entry is added through
# this API (the common path); a short TTL is the safety net for the rare
# case of a journal file being edited by something other than this route
# (e.g. a shell script appending directly).
_ENTRIES_CACHE_TTL_SECONDS = 30
_entries_cache: dict = {"data": None, "computed_at": 0.0}


def _invalidate_entries_cache() -> None:
    _entries_cache["data"] = None


async def _collect_all_entries() -> list[dict]:
    """Parse all journal files into structured entries: date, title, content, line.

    Cached for _ENTRIES_CACHE_TTL_SECONDS, invalidated immediately by
    add_journal_entry — see the cache comment above.
    """
    now = time.monotonic()
    if (
        _entries_cache["data"] is not None
        and (now - _entries_cache["computed_at"]) < _ENTRIES_CACHE_TTL_SECONDS
    ):
        return _entries_cache["data"]

    dates = await journal_service.list_dates()
    entries: list[dict] = []
    for date_str in dates:
        journal_date = date.fromisoformat(date_str)
        journal_file = journal_service._get_journal_file(journal_date)
        if not journal_file.exists():
            continue
        async with aiofiles.open(journal_file, "r") as f:
            lines = await f.readlines()
        current: Optional[dict] = None
        for i, line in enumerate(lines):
            if line.startswith("## "):
                if current:
                    entries.append(current)
                title = journal_service._parse_title(line)
                project = journal_service._parse_project_id(line)
                current = {
                    "date": date_str,
                    "title": title,
                    "project": project,
                    "content_lines": [],
                    "line": i + 1,
                }
            elif current:
                current["content_lines"].append(line.rstrip())
        if current:
            entries.append(current)

    _entries_cache["data"] = entries
    _entries_cache["computed_at"] = now
    return entries


def _word_set(text: str) -> set[str]:
    """Lowercase word tokens from text, filtering single-char words."""
    return {w for w in re.findall(r"[a-z0-9]+", text.lower()) if len(w) > 1}


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _keyword_recall(keywords: set[str], text_words: set[str]) -> float:
    """Fraction of keyword terms found in text. Asymmetric — does not penalize large documents."""
    if not keywords:
        return 0.0
    return len(keywords & text_words) / len(keywords)


# ── 1. GET /api/journal/stats ────────────────────────────────────────────────

@router.get("/stats")
async def get_journal_stats():
    """Corpus-level statistics: total entries, lines, date range, activity."""
    entries = await _collect_all_entries()
    if not entries:
        return {"total_entries": 0, "total_lines": 0, "date_range": None, "entries_per_day_avg": 0, "most_active_days": []}

    dates_list = sorted({e["date"] for e in entries})
    total_lines = sum(1 + len(e["content_lines"]) for e in entries)

    # Count entries per day
    day_counts: Counter[str] = Counter()
    for e in entries:
        day_counts[e["date"]] += 1

    most_active = [{"date": d, "entries": c} for d, c in day_counts.most_common(5)]
    avg = len(entries) / len(dates_list) if dates_list else 0

    return {
        "total_entries": len(entries),
        "total_lines": total_lines,
        "date_range": {"first": dates_list[0], "last": dates_list[-1]},
        "days_with_entries": len(dates_list),
        "entries_per_day_avg": round(avg, 1),
        "most_active_days": most_active,
    }


# ── 2. GET /api/journal/recurring-issues ─────────────────────────────────────

# Boilerplate journal template headers that aren't real "issues"
STOP_TITLES = {
    'what was done', 'key decisions', 'issues encountered', 'why',
    'commit', 'commits', 'test results', 'files changed', 'features',
    'what was produced', 'summary', 'context', 'background', 'notes',
    'overview', 'details', 'changes', 'updates', 'results',
    # Worker boilerplate
    'initialized', 'online', 'standing by', 'idle', 'awaiting',
    'session recovery', 'role loaded', 'ready for', 'task assignment',
    'awaiting task', 'worker guidelines', 'task complete', 'work complete',
}

# Negative filter: patterns that indicate non-issue titles (blacklist approach)
_NON_ISSUE_PATTERNS = [
    re.compile(r'^daily\b', re.IGNORECASE),           # Daily reports/digests
    re.compile(r'^v\d+', re.IGNORECASE),              # Version markers (v10, v12, etc.)
    re.compile(r'^(what|why|how|key|test|commit|files|features|summary|context|notes|verification|status|details|overview|results|priorities)\b', re.IGNORECASE),  # Section headers
]
_COMPLETION_WORDS = {'complete', 'completed', 'shipped', 'done', 'finished', 'verified', 'resolved'}
_STATUS_WORDS = {'initialized', 'online', 'ready', 'standing', 'awaiting', 'idle'}


def _is_non_issue_title(title: str) -> bool:
    """Return True if title matches non-issue patterns (negative filter)."""
    stripped = title.strip().lstrip("#").strip()
    # Pattern-based filters
    for pat in _NON_ISSUE_PATTERNS:
        if pat.search(stripped):
            return True
    # Completion/status language: if ALL content words are completion/status words, skip
    words = _word_set(stripped)
    if words and words <= (_COMPLETION_WORDS | _STATUS_WORDS):
        return True
    return False


@router.get("/recurring-issues")
async def get_recurring_issues():
    """Find titles appearing 2+ times across different dates using Jaccard word similarity >= 0.5."""
    entries = await _collect_all_entries()

    # Group by title word-set, cluster similar titles
    clusters: list[dict] = []  # {canonical, canonical_ws, word_set, dates, titles}

    for e in entries:
        ws = _word_set(e["title"])
        title_lower = e["title"].strip().lstrip("#").strip().lower()
        # Min 2 unique words + stop titles + negative filter
        if len(ws) < 2 or title_lower in STOP_TITLES or any(stop in title_lower for stop in STOP_TITLES):
            continue
        if _is_non_issue_title(e["title"]):
            continue
        matched = False
        for cluster in clusters:
            # Compare against canonical (first entry's) word set to prevent drift
            if _jaccard(ws, cluster["canonical_ws"]) >= 0.5:
                cluster["dates"].add(e["date"])
                cluster["titles"].append(e["title"])
                matched = True
                break
        if not matched:
            clusters.append({
                "canonical": e["title"],
                "canonical_ws": ws,  # frozen — used for matching
                "dates": {e["date"]},
                "titles": [e["title"]],
            })

    # Filter to clusters appearing on 2+ different dates
    recurring = []
    for c in clusters:
        if len(c["dates"]) >= 2:
            recurring.append({
                "canonical_title": c["canonical"],
                "occurrences": len(c["titles"]),
                "distinct_dates": len(c["dates"]),
                "dates": sorted(c["dates"]),
                "variant_titles": list(set(c["titles"]))[:5],
            })

    recurring.sort(key=lambda x: x["occurrences"], reverse=True)
    return {"recurring_issues": recurring, "total_clusters": len(recurring)}


# ── 3. GET /api/journal/weekly-summary ───────────────────────────────────────

@router.get("/weekly-summary")
async def get_weekly_summary(weeks_ago: int = Query(0, ge=0, le=52)):
    """Structured weekly summary: entries/day, top tags, commit count, task completions."""
    today = date.today()
    # Week starts on Monday
    week_start = today - timedelta(days=today.weekday() + 7 * weeks_ago)
    week_end = week_start + timedelta(days=6)

    entries = await _collect_all_entries()

    # Filter to this week
    week_entries = [e for e in entries if week_start.isoformat() <= e["date"] <= week_end.isoformat()]

    # Entries per day
    day_counts: dict[str, int] = {}
    current = week_start
    while current <= week_end:
        ds = current.isoformat()
        day_counts[ds] = sum(1 for e in week_entries if e["date"] == ds)
        current += timedelta(days=1)

    # Top project tags
    tag_counts: Counter[str] = Counter()
    for e in week_entries:
        if e["project"]:
            tag_counts[e["project"]] += 1
    top_tags = [{"tag": t, "count": c} for t, c in tag_counts.most_common(10)]

    # Count commits from git log for this week
    commit_count = 0
    try:
        result = await asyncio.to_thread(
            subprocess.run,
            ["git", "log", "--oneline", f"--after={week_start.isoformat()}", f"--before={(week_end + timedelta(days=1)).isoformat()}"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            commit_count = len([l for l in result.stdout.strip().split("\n") if l])
    except Exception:
        pass

    # Count task completions (entries with [DONE] or "COMPLETE" in title)
    task_completions = sum(
        1 for e in week_entries
        if "complete" in e["title"].lower() or "[done]" in e["title"].lower()
        or any("complete" in l.lower() or "[done]" in l.lower() for l in e["content_lines"])
    )

    return {
        "week_start": week_start.isoformat(),
        "week_end": week_end.isoformat(),
        "total_entries": len(week_entries),
        "entries_per_day": day_counts,
        "top_tags": top_tags,
        "commit_count": commit_count,
        "task_completions": task_completions,
    }


# ── 4. GET /api/journal/issue-lifecycle ──────────────────────────────────────

@router.get("/issue-lifecycle")
async def get_issue_lifecycle():
    """Recurring issues with git commit match for resolution detection."""
    entries = await _collect_all_entries()

    # Build clusters (same as recurring-issues)
    clusters: list[dict] = []
    for e in entries:
        ws = _word_set(e["title"])
        if len(ws) < 2:
            continue
        if _is_non_issue_title(e["title"]):
            continue
        title_lower = e["title"].strip().lstrip("#").strip().lower()
        if title_lower in STOP_TITLES or any(stop in title_lower for stop in STOP_TITLES):
            continue
        matched = False
        for cluster in clusters:
            # Compare against canonical word set to prevent drift
            if _jaccard(ws, cluster["canonical_ws"]) >= 0.5:
                cluster["dates"].add(e["date"])
                cluster["titles"].append(e["title"])
                cluster["entries"].append(e)
                matched = True
                break
        if not matched:
            clusters.append({
                "canonical": e["title"],
                "canonical_ws": ws,
                "dates": {e["date"]},
                "titles": [e["title"]],
                "entries": [e],
            })

    # Filter to recurring (2+ dates)
    recurring = [c for c in clusters if len(c["dates"]) >= 2]

    # Get git log for matching commits to issues
    commit_log: list[dict] = []
    try:
        result = await asyncio.to_thread(
            subprocess.run,
            ["git", "log", "--oneline", "-200"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            for line in result.stdout.strip().split("\n"):
                if line:
                    parts = line.split(" ", 1)
                    if len(parts) == 2:
                        commit_log.append({"hash": parts[0], "message": parts[1]})
    except Exception:
        pass

    lifecycle: list[dict] = []
    for c in recurring:
        # Find commits whose message has Jaccard >= 0.4 with the cluster word set
        related_commits = []
        for commit in commit_log:
            commit_ws = _word_set(commit["message"])
            if _jaccard(c["canonical_ws"], commit_ws) >= 0.4:
                related_commits.append(commit)

        # Heuristic: resolved if last entry content contains a commit hash or "complete"/"fixed"/"done"
        last_entry = max(c["entries"], key=lambda e: e["date"])
        last_content = " ".join(last_entry["content_lines"]).lower()
        last_title = last_entry["title"].lower()
        resolved = any(
            kw in last_content or kw in last_title
            for kw in ["complete", "fixed", "done", "resolved", "shipped"]
        )

        lifecycle.append({
            "canonical_title": c["canonical"],
            "occurrences": len(c["titles"]),
            "first_seen": min(c["dates"]),
            "last_seen": max(c["dates"]),
            "resolved": resolved,
            "related_commits": related_commits[:5],
            "variant_titles": list(set(c["titles"]))[:5],
        })

    lifecycle.sort(key=lambda x: x["occurrences"], reverse=True)
    return {"issues": lifecycle, "total": len(lifecycle)}


# ── 5. GET /api/journal/correction-compliance ────────────────────────────────

VIOLATION_SIGNALS = {
    "wrong", "broke", "reverted", "failed", "mistake",
    "fix-request", "regression", "rollback",
}

_AGENT_PATTERN = re.compile(r'\b(perm-\w+|sup-\w+|supervisor)\b')


def _extract_agent(entry: dict) -> str:
    """Extract the most likely agent name from a journal entry."""
    text = entry["title"] + " " + " ".join(entry["content_lines"])
    match = _AGENT_PATTERN.search(text)
    if match:
        return match.group(1)
    project = entry.get("project")
    if project:
        return project
    return "unknown"


async def _compute_correction_compliance() -> dict:
    """Compute correction compliance with per-agent breakdown."""
    rules_path = Path(__file__).resolve().parent.parent.parent.parent / ".soren" / "corrections-rules.json"
    if not rules_path.exists():
        return {"corrections": [], "overall_compliance": 1.0, "total_rules": 0, "per_agent": {}}

    rules = json.loads(rules_path.read_text())
    entries = await _collect_all_entries()

    # Per-agent tracking: agent -> {total, violations}
    agent_stats: dict[str, dict[str, int]] = defaultdict(lambda: {"total": 0, "violations": 0})

    corrections = []
    for rule in rules:
        rule_date = rule.get("added", "2000-01-01")
        keywords = {k.lower() for k in rule.get("trigger_keywords", []) if k}

        # Only entries after the rule was added
        relevant = [
            e for e in entries
            if e["date"] >= rule_date
            and _keyword_recall(keywords, _word_set(e["title"] + " " + " ".join(e["content_lines"]))) >= 0.15
        ]

        violations = 0
        for e in relevant:
            agent = _extract_agent(e)
            agent_stats[agent]["total"] += 1
            content_lower = (e["title"] + " " + " ".join(e["content_lines"])).lower()
            if any(sig in content_lower for sig in VIOLATION_SIGNALS):
                violations += 1
                agent_stats[agent]["violations"] += 1

        total = len(relevant)
        compliance = max(0.0, min(1.0, 1.0 - (violations / total))) if total > 0 else 1.0

        corrections.append({
            "id": rule["id"],
            "category": rule.get("category", ""),
            "rule": rule["rule"],
            "added": rule_date,
            "total_relevant_entries": total,
            "violations": violations,
            "compliance_rate": round(compliance, 4),
        })

    total_rules = len(corrections)
    overall = round(sum(c["compliance_rate"] for c in corrections) / total_rules, 4) if total_rules else 1.0

    # Build per-agent compliance
    per_agent: dict[str, dict] = {}
    for agent, stats in agent_stats.items():
        t, v = stats["total"], stats["violations"]
        rate = round(max(0.0, min(1.0, 1.0 - (v / t))), 4) if t > 0 else 1.0
        per_agent[agent] = {
            "total_relevant_entries": t,
            "violations": v,
            "compliance_rate": rate,
            "flagged": rate < 0.7,
        }

    return {
        "corrections": corrections,
        "overall_compliance": overall,
        "total_rules": total_rules,
        "per_agent": per_agent,
    }


@router.get("/correction-compliance")
async def get_correction_compliance():
    """Check how well the system follows its own correction rules."""
    return await _compute_correction_compliance()


@router.get("/compliance-trend")
async def get_compliance_trend(weeks: int = Query(8, ge=1, le=52)):
    """Per-agent correction compliance broken down by ISO week."""
    rules_path = Path(__file__).resolve().parent.parent.parent.parent / ".soren" / "corrections-rules.json"
    if not rules_path.exists():
        return {"weeks": []}

    rules = json.loads(rules_path.read_text())
    entries = await _collect_all_entries()

    # Determine the ISO weeks to cover
    today = date.today()
    current_iso = today.isocalendar()
    week_labels: list[str] = []
    for i in range(weeks - 1, -1, -1):
        d = today - timedelta(weeks=i)
        iso = d.isocalendar()
        week_labels.append(f"{iso[0]}-W{iso[1]:02d}")
    # Deduplicate while preserving order
    seen: set[str] = set()
    unique_weeks: list[str] = []
    for w in week_labels:
        if w not in seen:
            seen.add(w)
            unique_weeks.append(w)

    # Assign each entry to its ISO week
    def _entry_week(e: dict) -> str:
        d = date.fromisoformat(e["date"])
        iso = d.isocalendar()
        return f"{iso[0]}-W{iso[1]:02d}"

    entries_by_week: dict[str, list[dict]] = defaultdict(list)
    for e in entries:
        entries_by_week[_entry_week(e)].append(e)

    result_weeks: list[dict] = []
    for week_label in unique_weeks:
        week_entries = entries_by_week.get(week_label, [])
        agent_stats: dict[str, dict[str, int]] = defaultdict(lambda: {"total": 0, "violations": 0})
        total_all = 0
        violations_all = 0

        for rule in rules:
            rule_date = rule.get("added", "2000-01-01")
            keywords = {k.lower() for k in rule.get("trigger_keywords", []) if k}

            relevant = [
                e for e in week_entries
                if e["date"] >= rule_date
                and _keyword_recall(keywords, _word_set(e["title"] + " " + " ".join(e["content_lines"]))) >= 0.15
            ]

            for e in relevant:
                agent = _extract_agent(e)
                agent_stats[agent]["total"] += 1
                total_all += 1
                content_lower = (e["title"] + " " + " ".join(e["content_lines"])).lower()
                if any(sig in content_lower for sig in VIOLATION_SIGNALS):
                    agent_stats[agent]["violations"] += 1
                    violations_all += 1

        overall = round(1.0 - (violations_all / total_all), 4) if total_all > 0 else 1.0
        per_agent: dict[str, dict] = {}
        for agent, stats in agent_stats.items():
            t, v = stats["total"], stats["violations"]
            rate = round(max(0.0, min(1.0, 1.0 - (v / t))), 4) if t > 0 else 1.0
            per_agent[agent] = {
                "compliance_rate": rate,
                "violations": v,
                "total": t,
            }

        result_weeks.append({
            "week": week_label,
            "overall": overall,
            "per_agent": per_agent,
        })

    return {"weeks": result_weeks}


# ── 6. GET /api/journal/weekly-digest ─────────────────────────────────────────

@router.get("/weekly-digest")
async def get_weekly_digest(weeks_ago: int = Query(0, ge=0, le=52)):
    """Combined weekly digest: summary stats + correction compliance with per-agent breakdown."""
    summary = await get_weekly_summary(weeks_ago=weeks_ago)
    compliance = await _compute_correction_compliance()

    return {
        **summary,
        "correction_compliance": compliance,
    }


@router.post("/artifact")
async def upload_artifact(
    file: UploadFile = File(...),
    journal_date: Optional[str] = Query(None, alias="date"),
):
    """Upload an artifact file to today's (or specified date's) journal."""
    if journal_date:
        try:
            parsed_date = date.fromisoformat(journal_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")
    else:
        parsed_date = date.today()

    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename required")

    content = await file.read()
    path = await journal_service.save_artifact(
        filename=file.filename,
        content=content,
        journal_date=parsed_date,
    )

    return {
        "success": True,
        "filename": file.filename,
        "path": path,
    }


@router.get("/artifact/{filename}")
async def get_artifact(
    filename: str,
    journal_date: str = Query(..., alias="date"),
):
    """Download an artifact file."""
    try:
        parsed_date = date.fromisoformat(journal_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")

    content = await journal_service.get_artifact(filename, parsed_date)
    if content is None:
        raise HTTPException(status_code=404, detail="Artifact not found")

    # Guess content type from extension
    content_type = "application/octet-stream"
    if filename.endswith(".md"):
        content_type = "text/markdown"
    elif filename.endswith(".json"):
        content_type = "application/json"
    elif filename.endswith(".txt"):
        content_type = "text/plain"
    elif filename.endswith(".png"):
        content_type = "image/png"
    elif filename.endswith(".jpg") or filename.endswith(".jpeg"):
        content_type = "image/jpeg"

    return Response(content=content, media_type=content_type)
