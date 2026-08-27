from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import Optional

from ..services.memory_store import memory_store
from ..services import pattern_extractor

router = APIRouter()


class MemorySearchRequest(BaseModel):
    query: str
    limit: int = Field(default=5, ge=1, le=50)
    project_id: Optional[str] = None  # None = search all projects


class MemorySearchResult(BaseModel):
    id: str
    content: str
    source_type: str
    source_path: Optional[str] = None
    keywords: list[str] = []
    tags: list[str] = []
    score: float
    created_at: str
    project_id: str = "soren"


class MemorySearchResponse(BaseModel):
    query: str
    results: list[MemorySearchResult]
    total: int
    project_id: Optional[str] = None  # Echo back the filter used


class MemoryStatsResponse(BaseModel):
    total: int
    by_type: dict[str, int]
    by_project: dict[str, int] = {}
    query_count: int = 0


@router.post("/search", response_model=MemorySearchResponse)
async def search_memories(req: MemorySearchRequest):
    """Search memories by semantic similarity.

    If project_id is provided, restricts search to that project.
    If project_id is omitted, searches across ALL projects.
    """
    # Increment query counter
    _counter_path = Path('.soren/run/memory-query-count')
    _counter_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        count = int(_counter_path.read_text().strip()) if _counter_path.exists() else 0
        _counter_path.write_text(str(count + 1))
    except (ValueError, OSError):
        pass

    results = memory_store.search(query=req.query, limit=req.limit, project_id=req.project_id)
    return MemorySearchResponse(
        query=req.query,
        results=results,
        total=len(results),
        project_id=req.project_id,
    )


@router.get("/stats", response_model=MemoryStatsResponse)
async def get_memory_stats():
    """Get memory store statistics including per-project breakdown."""
    query_count = 0
    try:
        _qc = Path('.soren/run/memory-query-count')
        if _qc.exists():
            query_count = int(_qc.read_text().strip())
    except (ValueError, OSError):
        pass

    stats = memory_store.stats()
    return MemoryStatsResponse(**stats, query_count=query_count)


class ExtractPatternsRequest(BaseModel):
    commits: int = Field(default=5, ge=1, le=50)
    date: Optional[str] = None  # YYYY-MM-DD; if omitted uses today
    project_id: str = "soren"
    scope: str = "supervisor"  # "supervisor" (default) or "team"
    team: Optional[str] = None  # required when scope="team"


class ExtractPatternsResponse(BaseModel):
    found: int
    stored: int
    pattern_total: int


@router.post("/extract-patterns", response_model=ExtractPatternsResponse)
async def extract_patterns(req: ExtractPatternsRequest):
    """Trigger pattern extraction from recent commits and/or a journal date.

    Stores extracted patterns in the memory store with source_type='pattern'.
    """
    from datetime import datetime, timezone

    date = req.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    total_found = 0
    total_stored = 0

    # Extract from journal
    journal_patterns = pattern_extractor.extract_patterns_from_journal(date, scope=req.scope, team=req.team)
    if journal_patterns:
        stored = pattern_extractor.store_patterns(journal_patterns, project_id=req.project_id)
        total_found += len(journal_patterns)
        total_stored += stored

    # Extract from recent commits
    import subprocess
    try:
        shas = subprocess.check_output(
            ["git", "log", f"-{req.commits}", "--format=%H"],
            text=True, timeout=10,
        ).strip().splitlines()
    except Exception:
        shas = []

    for sha in shas:
        commit_patterns = pattern_extractor.extract_patterns_from_commit(sha.strip())
        if commit_patterns:
            stored = pattern_extractor.store_patterns(commit_patterns, project_id=req.project_id)
            total_found += len(commit_patterns)
            total_stored += stored

    stats = memory_store.stats()
    pattern_total = stats.get("by_type", {}).get("pattern", 0)

    return ExtractPatternsResponse(
        found=total_found,
        stored=total_stored,
        pattern_total=pattern_total,
    )
