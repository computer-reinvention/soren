from pydantic import BaseModel, Field
from datetime import datetime, date
from typing import Optional


class JournalEntry(BaseModel):
    """A single journal entry."""

    title: str
    content: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now().astimezone())
    project_id: Optional[str] = None


class JournalEntryCreate(BaseModel):
    """Request to create a journal entry."""

    title: str
    content: str
    project_id: Optional[str] = None


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
