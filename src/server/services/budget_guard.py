"""Budget guard — cost estimation and task deferral helpers.

Real cost (see ``opencode_transcripts.py``, which reads opencode's own
already-priced numbers straight from its session database) is used first
wherever it's available. ``pricing.tokens_to_usd`` (re-exported below for
backward compatibility) is only the fallback estimate for the gap — a
session opencode's own database doesn't have a record of, or the database
being unreachable entirely.
"""

import os
from datetime import date

from . import opencode_transcripts
from .conversation_store import conversation_store
from .pricing import tokens_to_usd  # noqa: F401 — re-exported for callers

THROTTLE_THRESHOLD = 0.80  # defer low-priority work above 80% of daily budget


def project_directory() -> str:
    """Repo root as opencode's own session table records it (its
    ``directory`` column) — mirrors ``routes/terminal.py``'s
    ``_repo_root()``, duplicated rather than imported to avoid a
    services -> routes layering dependency for one small helper.
    """
    env_root = os.environ.get("SOREN_PROJECT_ROOT")
    if env_root:
        return str(env_root)
    from ..config import settings

    return str(settings.soren_dir.resolve().parent)


def get_daily_spend_usd() -> float:
    """Return today's real cost in USD (UTC date) if opencode's own
    session database has it; falls back to SOREN's own token-based
    estimate for the gap (missing/unreachable DB, or a day opencode has no
    record of, e.g. from before this feature existed).
    """
    today = date.today().isoformat()
    real_by_day = opencode_transcripts.get_daily_real_cost(project_directory())
    if today in real_by_day:
        return real_by_day[today]
    for day in conversation_store.get_daily_budget():
        if day["date"] == today:
            return tokens_to_usd(
                day["input_tokens"],
                day["output_tokens"],
                day["cache_read_tokens"],
                day["cache_creation_tokens"],
            )
    return 0.0


def get_budget_limit_usd() -> float:
    """Return the daily budget limit from env var SOREN_DAILY_BUDGET (default $600)."""
    return float(os.getenv("SOREN_DAILY_BUDGET", "0"))


def get_budget_status() -> dict:
    """Return current spend vs limit with throttle flag."""
    limit = get_budget_limit_usd()
    spend = get_daily_spend_usd()
    percentage = (spend / limit) if limit > 0 else 0.0
    return {
        "daily_spend_usd": round(spend, 6),
        "budget_limit_usd": round(limit, 2),
        "percentage_used": round(percentage, 4),
        "throttled": percentage >= THROTTLE_THRESHOLD,
    }


def should_defer_task(priority: str) -> bool:
    """Return True if a low-priority task should be deferred due to budget.

    Usage in supervisor:
        if budget_guard.should_defer_task("low"):
            skip AMBITION self-improvement work
    """
    if priority != "low":
        return False
    return get_budget_status()["throttled"]
