from pathlib import Path
from datetime import date, datetime
import aiofiles
import aiofiles.os
import re
from typing import Optional

from ..config import settings
from ..models.journal import (
    JournalEntry,
    JournalDayResponse,
    JournalSearchResult,
)


class JournalService:
    """Service for managing daily journal entries."""

    def __init__(self, base_path: Optional[Path] = None):
        self.base_path = base_path or settings.journal_path

    def _get_day_path(self, journal_date: date) -> Path:
        """Get path to journal directory for a specific date."""
        return self.base_path / journal_date.strftime("%Y-%m-%d")

    def _get_journal_file(self, journal_date: date) -> Path:
        """Get path to journal.md for a specific date."""
        return self._get_day_path(journal_date) / "journal.md"

    def _get_artifacts_dir(self, journal_date: date) -> Path:
        """Get path to artifacts directory for a specific date."""
        return self._get_day_path(journal_date) / "artifacts"

    async def ensure_day_exists(self, journal_date: date) -> None:
        """Ensure journal directory structure exists for a date."""
        day_path = self._get_day_path(journal_date)
        artifacts_path = self._get_artifacts_dir(journal_date)

        await aiofiles.os.makedirs(day_path, exist_ok=True)
        await aiofiles.os.makedirs(artifacts_path, exist_ok=True)

        # Create journal.md if it doesn't exist
        journal_file = self._get_journal_file(journal_date)
        if not journal_file.exists():
            async with aiofiles.open(journal_file, "w") as f:
                await f.write(f"# Journal - {journal_date.strftime('%Y-%m-%d')}\n")

    @staticmethod
    def _parse_project_id(header_line: str) -> Optional[str]:
        """Extract project ID from a journal header line.

        Parses headers like '## 09:16 - [my-project] Title' and returns 'my-project'.
        Returns None if no project tag is present.
        """
        match = re.match(r"## \d{2}:\d{2} - \[([^\]]+)\] ", header_line)
        return match.group(1) if match else None

    @staticmethod
    def _parse_title(header_line: str) -> str:
        """Extract the title from a journal header line, stripping time and project tag."""
        # With project tag: ## 09:16 - [proj] Title
        match = re.match(r"## \d{2}:\d{2} - \[[^\]]+\] (.+)", header_line)
        if match:
            return match.group(1).strip()
        # Without project tag: ## 09:16 - Title
        match = re.match(r"## \d{2}:\d{2} - (.+)", header_line)
        return match.group(1).strip() if match else header_line.strip()

    async def add_entry(
        self, title: str, content: str, journal_date: Optional[date] = None, project_id: Optional[str] = None
    ) -> JournalEntry:
        """Add a new entry to the journal."""
        journal_date = journal_date or date.today()
        await self.ensure_day_exists(journal_date)

        now_local = datetime.now().astimezone()
        entry = JournalEntry(
            title=title,
            content=content,
            timestamp=now_local,
            project_id=project_id,
        )

        journal_file = self._get_journal_file(journal_date)
        time_str = now_local.strftime("%H:%M")

        # Build header with optional project tag
        if project_id:
            header = f"## {time_str} - [{project_id}] {title}"
        else:
            header = f"## {time_str} - {title}"

        # Only append content body if non-empty (quick logs have no body)
        if content and content.strip():
            entry_text = f"\n{header}\n{content}\n"
        else:
            entry_text = f"\n{header}\n"

        async with aiofiles.open(journal_file, "a") as f:
            await f.write(entry_text)

        return entry

    async def get_day(self, journal_date: date, project: Optional[str] = None) -> JournalDayResponse:
        """Get journal content for a specific date, optionally filtered by project."""
        journal_file = self._get_journal_file(journal_date)
        artifacts_dir = self._get_artifacts_dir(journal_date)

        content = ""
        if journal_file.exists():
            async with aiofiles.open(journal_file, "r") as f:
                raw_content = await f.read()

            if project:
                content = self._filter_by_project(raw_content, project)
            else:
                content = raw_content

        artifacts = []
        if artifacts_dir.exists():
            artifacts = [f.name for f in artifacts_dir.iterdir() if f.is_file()]

        return JournalDayResponse(
            date=journal_date.strftime("%Y-%m-%d"),
            content=content,
            artifacts=artifacts,
        )

    def _filter_by_project(self, content: str, project: str) -> str:
        """Filter journal markdown content to only include entries for a given project."""
        lines = content.split("\n")
        result_lines: list[str] = []
        include = False

        for line in lines:
            if line.startswith("## "):
                pid = self._parse_project_id(line)
                include = pid == project
            elif line.startswith("# "):
                # Keep the day header
                result_lines.append(line)
                continue

            if include:
                result_lines.append(line)

        return "\n".join(result_lines)

    async def list_dates(self) -> list[str]:
        """List all dates that have journal entries."""
        if not self.base_path.exists():
            return []

        dates = []
        for item in self.base_path.iterdir():
            if item.is_dir() and re.match(r"\d{4}-\d{2}-\d{2}", item.name):
                journal_file = item / "journal.md"
                if journal_file.exists():
                    dates.append(item.name)

        return sorted(dates, reverse=True)

    async def search(
        self, query: str, limit: int = 20, project: Optional[str] = None
    ) -> list[JournalSearchResult]:
        """Search journal entries for a query string, optionally filtered by project."""
        results = []
        query_lower = query.lower()

        dates = await self.list_dates()

        for date_str in dates:
            journal_date = date.fromisoformat(date_str)
            journal_file = self._get_journal_file(journal_date)

            if not journal_file.exists():
                continue

            async with aiofiles.open(journal_file, "r") as f:
                lines = await f.readlines()

            current_title = ""
            current_project: Optional[str] = None
            for line_num, line in enumerate(lines, 1):
                # Track current section title and project
                if line.startswith("## "):
                    current_project = self._parse_project_id(line)
                    current_title = self._parse_title(line)

                # Skip entries that don't match the project filter
                if project and current_project != project:
                    continue

                if query_lower in line.lower():
                    snippet = line.strip()[:200]
                    if len(line.strip()) > 200:
                        snippet += "..."

                    results.append(JournalSearchResult(
                        date=date_str,
                        title=current_title or "Journal",
                        snippet=snippet,
                        line_number=line_num,
                        project_id=current_project,
                    ))

                    if len(results) >= limit:
                        return results

        return results

    async def save_artifact(
        self,
        filename: str,
        content: bytes,
        journal_date: Optional[date] = None,
    ) -> str:
        """Save an artifact file."""
        journal_date = journal_date or date.today()
        await self.ensure_day_exists(journal_date)

        artifacts_dir = self._get_artifacts_dir(journal_date)
        artifact_path = artifacts_dir / filename

        async with aiofiles.open(artifact_path, "wb") as f:
            await f.write(content)

        return str(artifact_path)

    async def get_artifact(self, filename: str, journal_date: date) -> Optional[bytes]:
        """Get artifact content."""
        artifact_path = self._get_artifacts_dir(journal_date) / filename

        if not artifact_path.exists():
            return None

        async with aiofiles.open(artifact_path, "rb") as f:
            return await f.read()


# Singleton instance
journal_service = JournalService()
