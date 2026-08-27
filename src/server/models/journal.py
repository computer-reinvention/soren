from pydantic import BaseModel, Field
from datetime import datetime, date
from typing import Optional


class JournalEntry(BaseModel):
    """A single journal entry."""

    title: str
    content: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now().astimezone())
    project_id: Optional[str] = None
    scope: str = "supervisor"
    team: Optional[str] = None


class JournalEntryCreate(BaseModel):
    """Request to create a journal entry.

    scope/team: which journal this entry is written to. "supervisor" (the
    default, and the only scope that existed before this field was added)
    is the single global journal; "team" requires `team` to be set to a
    real `teams` table prefix and writes into that team's own, isolated
    journal. There is deliberately no cross-scope write — a caller either
    targets their own scope or the supervisor's.

    tags: previously accepted by real callers (AGENTS.md's own journaling
    snippet, monitor.sh's daily digest) but silently dropped since this
    model had no such field. Now recorded as a visible "Tags:" line in the
    entry body rather than lost -- there's no structured tag-query system
    built on top of this yet, just no-longer-silent data loss.
    """

    title: str
    content: str
    project_id: Optional[str] = None
    scope: str = "supervisor"
    team: Optional[str] = None
    tags: list[str] = Field(default_factory=list)


class JournalDay(BaseModel):
    """Journal data for a single day."""

    date: date
    entries: list[JournalEntry]
    artifacts: list[str] = []  # List of artifact filenames


class JournalDayResponse(BaseModel):
    """Response containing journal day data."""

    date: str
    content: str  # Raw markdown content
    artifacts: list[str]


class JournalDatesResponse(BaseModel):
    """Response listing available journal dates."""

    dates: list[str]


class JournalSearchResult(BaseModel):
    """A single search result."""

    date: str
    title: str
    snippet: str
    line_number: int
    project_id: Optional[str] = None


class JournalSearchResponse(BaseModel):
    """Response from journal search."""

    query: str
    results: list[JournalSearchResult]
    total: int


class ArtifactUpload(BaseModel):
    """Metadata for artifact upload."""

    filename: str
    description: Optional[str] = None
