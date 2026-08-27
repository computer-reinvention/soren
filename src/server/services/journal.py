from pathlib import Path
from datetime import date, datetime
import aiofiles
import aiofiles.os
import logging
import re
from typing import Optional

from ..config import settings
from ..models.journal import (
    JournalEntry,
    JournalDayResponse,
    JournalSearchResult,
)

logger = logging.getLogger(__name__)


class JournalService:
    """Service for managing daily journal entries.

    Journal storage is split into isolated scopes:

        .soren/journal/
          supervisor/<date>/journal.md + artifacts/   <- single global scope
          teams/<prefix>/<date>/journal.md + artifacts/  <- one per teams-table row

    "supervisor" is the default and the only scope that existed before this
    split (all pre-existing history lives there, moved by a one-time
    migration). Team scopes are strictly isolated from each other -- this
    service exposes no operation that reads or writes across two different
    team scopes at once; a caller always names exactly one scope. Aggregation
    across scopes (for supervisor-level oversight, e.g. recurring issues or
    compliance tracking) happens one layer up, in routes/journal.py, by
    calling into this service once per scope and combining the results --
    not by adding a "give me everything" mode here.

    `attachments/` (mailbox message bodies, webhook payloads, log-watcher
    alerts, worker screenshots) is deliberately NOT part of this scope model
    and is untouched by this class -- it's written by three other subsystems
    directly to `.soren/journal/<date>/attachments/` and stays flat/global.
    """

    def __init__(self, base_path: Optional[Path] = None):
        self.base_path = base_path or settings.journal_path

    def _resolve_scope_dir(self, scope: str = "supervisor", team: Optional[str] = None) -> Path:
        """Resolve the root directory for a given scope.

        Raises ValueError for an unknown scope or a "team" scope missing
        its team prefix -- callers (routes/journal.py) translate this into
        an HTTP 400 rather than silently falling back to some default scope.
        """
        if scope == "supervisor":
            return self.base_path / "supervisor"
        if scope == "team":
            if not team:
                raise ValueError("team is required when scope='team'")
            return self.base_path / "teams" / team
        raise ValueError(f"unknown journal scope: {scope!r}")

    def _get_day_path(self, journal_date: date, scope: str = "supervisor", team: Optional[str] = None) -> Path:
        """Get path to journal directory for a specific date within a scope."""
        return self._resolve_scope_dir(scope, team) / journal_date.strftime("%Y-%m-%d")

    def _get_journal_file(self, journal_date: date, scope: str = "supervisor", team: Optional[str] = None) -> Path:
        """Get path to journal.md for a specific date within a scope."""
        return self._get_day_path(journal_date, scope, team) / "journal.md"

    def _get_artifacts_dir(self, journal_date: date, scope: str = "supervisor", team: Optional[str] = None) -> Path:
        """Get path to artifacts directory for a specific date within a scope."""
        return self._get_day_path(journal_date, scope, team) / "artifacts"

    async def list_teams(self) -> list[str]:
        """List team prefixes that have a journal directory (i.e. have ever
        journaled), sorted alphabetically. Purely a filesystem scan -- this
        service has no database dependency; identity/team-membership
        resolution for auto-routing a write happens in the caller
        (tools/journal), not here.
        """
        teams_root = self.base_path / "teams"
        if not teams_root.exists():
            return []
        return sorted(p.name for p in teams_root.iterdir() if p.is_dir())

    async def ensure_day_exists(self, journal_date: date, scope: str = "supervisor", team: Optional[str] = None) -> None:
        """Ensure journal directory structure exists for a date within a scope."""
        day_path = self._get_day_path(journal_date, scope, team)
        artifacts_path = self._get_artifacts_dir(journal_date, scope, team)

        await aiofiles.os.makedirs(day_path, exist_ok=True)
        await aiofiles.os.makedirs(artifacts_path, exist_ok=True)

        # Create journal.md if it doesn't exist
        journal_file = self._get_journal_file(journal_date, scope, team)
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
        self,
        title: str,
        content: str,
        journal_date: Optional[date] = None,
        project_id: Optional[str] = None,
        scope: str = "supervisor",
        team: Optional[str] = None,
        tags: Optional[list[str]] = None,
    ) -> JournalEntry:
        """Add a new entry to the journal for the given scope."""
        journal_date = journal_date or date.today()
        await self.ensure_day_exists(journal_date, scope, team)

        now_local = datetime.now().astimezone()
        entry = JournalEntry(
            title=title,
            content=content,
            timestamp=now_local,
            project_id=project_id,
            scope=scope,
            team=team,
        )

        journal_file = self._get_journal_file(journal_date, scope, team)
        time_str = now_local.strftime("%H:%M")

        # Build header with optional project tag
        if project_id:
            header = f"## {time_str} - [{project_id}] {title}"
        else:
            header = f"## {time_str} - {title}"

        # Tags aren't part of the header/parsing format -- recorded as a
        # visible line in the body instead so they're never silently
        # dropped (see JournalEntryCreate docstring).
        body = content or ""
        if tags:
            tags_line = f"**Tags:** {', '.join(tags)}"
            body = f"{tags_line}\n\n{body}" if body.strip() else tags_line

        # Only append content body if non-empty (quick logs have no body)
        if body and body.strip():
            entry_text = f"\n{header}\n{body}\n"
        else:
            entry_text = f"\n{header}\n"

        async with aiofiles.open(journal_file, "a") as f:
            await f.write(entry_text)

        return entry

    async def get_day(
        self,
        journal_date: date,
        project: Optional[str] = None,
        scope: str = "supervisor",
        team: Optional[str] = None,
    ) -> JournalDayResponse:
        """Get journal content for a specific date/scope, optionally filtered by project."""
        journal_file = self._get_journal_file(journal_date, scope, team)
        artifacts_dir = self._get_artifacts_dir(journal_date, scope, team)

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

    async def list_dates(self, scope: str = "supervisor", team: Optional[str] = None) -> list[str]:
        """List all dates that have journal entries within a scope."""
        scope_dir = self._resolve_scope_dir(scope, team)
        if not scope_dir.exists():
            return []

        dates = []
        for item in scope_dir.iterdir():
            if item.is_dir() and re.match(r"\d{4}-\d{2}-\d{2}", item.name):
                journal_file = item / "journal.md"
                if journal_file.exists():
                    dates.append(item.name)

        return sorted(dates, reverse=True)

    async def search(
        self,
        query: str,
        limit: int = 20,
        project: Optional[str] = None,
        scope: str = "supervisor",
        team: Optional[str] = None,
    ) -> list[JournalSearchResult]:
        """Search journal entries for a query string within a scope, optionally filtered by project."""
        results = []
        query_lower = query.lower()

        dates = await self.list_dates(scope, team)

        for date_str in dates:
            journal_date = date.fromisoformat(date_str)
            journal_file = self._get_journal_file(journal_date, scope, team)

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
        scope: str = "supervisor",
        team: Optional[str] = None,
    ) -> str:
        """Save an artifact file within a scope."""
        journal_date = journal_date or date.today()
        await self.ensure_day_exists(journal_date, scope, team)

        artifacts_dir = self._get_artifacts_dir(journal_date, scope, team)
        artifact_path = artifacts_dir / filename

        async with aiofiles.open(artifact_path, "wb") as f:
            await f.write(content)

        return str(artifact_path)

    async def get_artifact(
        self, filename: str, journal_date: date, scope: str = "supervisor", team: Optional[str] = None
    ) -> Optional[bytes]:
        """Get artifact content from a scope."""
        artifact_path = self._get_artifacts_dir(journal_date, scope, team) / filename

        if not artifact_path.exists():
            return None

        async with aiofiles.open(artifact_path, "rb") as f:
            return await f.read()


# Singleton instance
journal_service = JournalService()


def resolve_scope_for_agent(agent_key: str) -> tuple[str, Optional[str]]:
    """Resolve which journal scope an agent's own entries/artifacts belong to:
    ("team", prefix) if agent_key is a member of a `teams` table row,
    otherwise ("supervisor", None).

    This is the Python-side equivalent of tools/journal's resolve_scope_dir()
    and pre-compact.sh's team lookup -- the same rule (membership in a
    `teams` row) implemented three times across bash and Python because
    journal writes happen from both worlds. Keep all three in sync if this
    rule ever changes.

    Best-effort: any DB error (missing table, missing file) falls back to
    the supervisor scope rather than raising, matching the bash versions.
    """
    from .db import get_db  # local import: avoid a hard dependency for callers that never hit this path

    try:
        with get_db() as conn:
            row = conn.execute(
                "SELECT teams.prefix FROM teams, json_each(teams.members) "
                "WHERE json_each.value = ? LIMIT 1",
                (agent_key,),
            ).fetchone()
        if row:
            return "team", row[0]
    except Exception as exc:
        logger.warning(f"resolve_scope_for_agent failed for {agent_key!r}, defaulting to supervisor: {exc}")

    return "supervisor", None
