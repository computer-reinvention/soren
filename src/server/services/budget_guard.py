"""Budget guard — cost estimation and task deferral helpers.

Token pricing uses Claude Opus 4.6 rates (via opencode) since all agents run on Opus.
"""

import os
from datetime import date

from .conversation_store import conversation_store

# Anthropic token pricing (Claude Opus 4.6 via opencode, USD per token)
_INPUT_PRICE_PER_TOKEN        = 5.00  / 1_000_000
_OUTPUT_PRICE_PER_TOKEN       = 25.00 / 1_000_000
_CACHE_READ_PRICE_PER_TOKEN   = 0.50  / 1_000_000
_CACHE_WRITE_PRICE_PER_TOKEN  = 6.25  / 1_000_000

THROTTLE_THRESHOLD = 0.80  # defer low-priority work above 80% of daily budget


def tokens_to_usd(
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int = 0,
    cache_creation_tokens: int = 0,
) -> float:
    """Convert token counts to estimated USD cost."""
    return (
        input_tokens        * _INPUT_PRICE_PER_TOKEN
        + output_tokens     * _OUTPUT_PRICE_PER_TOKEN
        + cache_read_tokens * _CACHE_READ_PRICE_PER_TOKEN
        + cache_creation_tokens * _CACHE_WRITE_PRICE_PER_TOKEN
    )


def get_daily_spend_usd() -> float:
    """Return today's estimated token cost in USD (UTC date)."""
    today = date.today().isoformat()
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
