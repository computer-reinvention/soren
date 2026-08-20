"""Teams API — reads the `teams` table in the consolidated SQLite DB.

Teams are created by `tools/teams`, which records them in the sqlite master
and regenerates the read-only .soren/teams.json view:
    {"teams": [{prefix, template, task, members: [names], project_id, created_at}]}
(permanent teams carry an extra `permanent: true`).

This route reads the sqlite master directly (the view can lag a concurrent
writer) and enriches each member with live status from the agent registry.
If the table is empty but a populated legacy teams.json exists, it is imported
once (the file is kept — it becomes the regenerated view).

NOTE (shared schema + view shape): duplicated in tools/teams — keep in sync.
"""

from fastapi import APIRouter, HTTPException
from pathlib import Path
import json
import logging
import os
import sqlite3

from ..config import settings
from ..services.agent_registry import agent_registry
from ..services.db import get_db

logger = logging.getLogger(__name__)

router = APIRouter()

SCHEMA = """
CREATE TABLE IF NOT EXISTS teams (
    prefix     TEXT PRIMARY KEY,
    template   TEXT,
    task       TEXT,
    project_id TEXT,
    created_at TEXT,
    members    TEXT DEFAULT '[]',
    permanent  INTEGER DEFAULT 0
)
"""


def get_teams_file() -> Path:
    """Resolve the path to the teams.json view.

    Module-level function so tests can monkeypatch the path resolution.
    """
    return settings.soren_dir / "teams.json"


def _import_legacy(conn: sqlite3.Connection) -> None:
    """One-time lazy import: table empty + populated teams.json → seed the
    table from it. The file stays in place as the regenerated view."""
    count = conn.execute("SELECT COUNT(*) FROM teams").fetchone()[0]
    if count > 0:
        return
    path = get_teams_file()
    if not path.exists():
        return
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as e:
        logger.warning("Failed to read teams file %s: %s", path, e)
        return
    if not isinstance(data, dict):
        return
    teams = data.get("teams", [])
    if not isinstance(teams, list):
        return
    teams = [t for t in teams if isinstance(t, dict) and t.get("prefix")]
    if not teams:
        return
    for t in teams:
        members = t.get("members", [])
        if not isinstance(members, list):
            members = []
        conn.execute(
            "INSERT OR IGNORE INTO teams "
            "(prefix, template, task, project_id, created_at, members, permanent) "
            "VALUES (?,?,?,?,?,?,?)",
            (
                t.get("prefix"),
                t.get("template") or "",
                t.get("task") or "",
                t.get("project_id") or "",
                t.get("created_at") or "",
                json.dumps(members, ensure_ascii=False, separators=(",", ":")),
                1 if t.get("permanent") else 0,
            ),
        )
    conn.commit()
    logger.info(
        "Imported %d team(s) from legacy %s into sqlite (file kept as view)",
        len(teams), path,
    )
    _regenerate_view(conn)


def _row_to_team(row: sqlite3.Row) -> dict:
    """Table row → legacy record shape (members as a real list; the
    `permanent` key present only for permanent teams)."""
    try:
        members = json.loads(row["members"] or "[]")
    except (json.JSONDecodeError, TypeError):
        members = []
    if not isinstance(members, list):
        members = []
    team = {
        "prefix": row["prefix"],
        "template": row["template"],
        "task": row["task"],
        "members": members,
        "project_id": row["project_id"],
    }
    if row["permanent"]:
        team["permanent"] = True
    team["created_at"] = row["created_at"]
    return team


def _regenerate_view(conn: sqlite3.Connection) -> None:
    """Regenerate the read-only teams.json view (call AFTER commit).
    Byte format matches the bash regeneration in tools/teams (`jq .`):
    json.dumps(indent=2, ensure_ascii=False) + '\\n', tmp+rename."""
    try:
        rows = conn.execute("SELECT * FROM teams ORDER BY rowid").fetchall()
        teams = [_row_to_team(r) for r in rows]
        view = get_teams_file()
        view.parent.mkdir(parents=True, exist_ok=True)
        tmp = view.with_name(f"{view.name}.tmp.{os.getpid()}")
        tmp.write_text(json.dumps({"teams": teams}, indent=2, ensure_ascii=False) + "\n")
        tmp.rename(view)
    except OSError as e:
        logger.warning("teams.json view regeneration failed: %s", e)


def _load_raw_teams() -> list:
    """Read team records from the sqlite master ([] on any error)."""
    try:
        with get_db() as conn:
            conn.execute(SCHEMA)
            _import_legacy(conn)
            rows = conn.execute("SELECT * FROM teams ORDER BY rowid").fetchall()
            return [_row_to_team(r) for r in rows]
    except sqlite3.Error as e:
        logger.warning("Failed to read teams table: %s", e)
        return []


def _enrich_member(name: str) -> dict:
    """Attach live registry status to a team member name."""
    meta = agent_registry.get_agent_metadata(name)
    if meta is None:
        found = agent_registry.find_by_display_name(name)
        meta = found[1] if found else None
    return {
        "name": name,
        "in_registry": meta is not None,
        "status": meta.get("status") if meta else None,
        "agent_id": meta.get("agent_id") if meta else None,
        "display_name": meta.get("display_name") if meta else None,
        "role": meta.get("role") if meta else None,
    }


def _enrich_team(team: dict) -> dict:
    """Return a copy of the team record with enriched member entries."""
    members = team.get("members", [])
    if not isinstance(members, list):
        members = []
    enriched = dict(team)
    enriched["members"] = [_enrich_member(str(m)) for m in members]
    return enriched


@router.get("")
async def list_teams():
    """List all teams with live member status."""
    teams = [_enrich_team(t) for t in _load_raw_teams()]
    return {"teams": teams, "total": len(teams)}


@router.get("/{prefix}")
async def get_team(prefix: str):
    """Get a single team by its prefix."""
    for team in _load_raw_teams():
        if team.get("prefix") == prefix:
            return _enrich_team(team)
    raise HTTPException(status_code=404, detail="Team not found")
