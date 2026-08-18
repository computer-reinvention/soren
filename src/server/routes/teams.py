"""Teams API — read-only view over .soren/teams.json.

Teams are created by `tools/teams` which records them in .soren/teams.json:
    {"teams": [{prefix, template, task, members: [names], project_id, created_at}]}

This route enriches each member with live status from the agent registry.
"""

from fastapi import APIRouter, HTTPException
from pathlib import Path
import json
import logging

from ..config import settings
from ..services.agent_registry import agent_registry

logger = logging.getLogger(__name__)

router = APIRouter()


def get_teams_file() -> Path:
    """Resolve the path to teams.json.

    Module-level function so tests can monkeypatch the path resolution.
    """
    return settings.soren_dir / "teams.json"


def _load_raw_teams() -> list:
    """Read teams.json, returning [] for missing/empty/malformed files."""
    path = get_teams_file()
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as e:
        logger.warning("Failed to read teams file %s: %s", path, e)
        return []
    if not isinstance(data, dict):
        return []
    teams = data.get("teams", [])
    if not isinstance(teams, list):
        return []
    return [t for t in teams if isinstance(t, dict)]


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
