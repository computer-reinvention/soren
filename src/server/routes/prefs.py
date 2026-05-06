from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

router = APIRouter()

PREFS_FILE = Path(".soren/prefs.json")

# Default heartbeat config (mirrors monitor.sh defaults)
DEFAULT_PREFS = {
    "heartbeat_warn_threshold": 600,
    "heartbeat_nudge_interval": 120,
    "heartbeat_max_nudges": 3,
    "heartbeat_observe_timeout": 1200,
}


class PrefsUpdate(BaseModel):
    heartbeat_warn_threshold: Optional[int] = None
    heartbeat_nudge_interval: Optional[int] = None
    heartbeat_max_nudges: Optional[int] = None
    heartbeat_observe_timeout: Optional[int] = None


def _load_prefs() -> dict:
    if PREFS_FILE.exists():
        try:
            return {**DEFAULT_PREFS, **json.loads(PREFS_FILE.read_text())}
        except Exception:
            pass
    return {**DEFAULT_PREFS}


def _save_prefs(prefs: dict) -> None:
    PREFS_FILE.parent.mkdir(parents=True, exist_ok=True)
    PREFS_FILE.write_text(json.dumps(prefs, indent=2) + "\n")


@router.get("")
async def get_prefs():
    """Return current preferences."""
    return _load_prefs()


@router.put("")
async def update_prefs(update: PrefsUpdate):
    """Update preferences. Only provided fields are changed."""
    prefs = _load_prefs()
    for key, val in update.model_dump(exclude_none=True).items():
        prefs[key] = val
    _save_prefs(prefs)
    return prefs
