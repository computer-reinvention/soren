from fastapi import APIRouter, Query

from ..services.conversation_store import conversation_store
from ..services import budget_guard

router = APIRouter()


@router.get("/status")
async def get_budget_status():
    """Return today's spend vs daily budget limit.

    budget_limit_usd is read from env var SOREN_DAILY_BUDGET (default $200).
    throttled is true when percentage_used >= 80%.
    """
    return budget_guard.get_budget_status()


@router.get("")
async def get_budget_summary():
    """Get per-agent token usage totals.

    Returns aggregated input/output/cache token counts for each agent
    that has usage data in their events.
    """
    agents = conversation_store.get_budget_summary()
    return {"agents": agents}


@router.get("/daily")
async def get_daily_budget():
    """Get per-day token usage with cost trending.

    Each day includes: token counts, estimated USD cost,
    7_day_moving_avg (average daily cost over trailing 7 days),
    and day_over_day_delta (cost change from previous day).
    """
    days = conversation_store.get_daily_budget()

    # Compute USD cost per day and attach trending fields
    enriched = []
    for day in days:
        cost = budget_guard.tokens_to_usd(
            day["input_tokens"],
            day["output_tokens"],
            day.get("cache_read_tokens", 0),
            day.get("cache_creation_tokens", 0),
        )
        day["cost_usd"] = round(cost, 4)
        enriched.append(day)

    # Days are newest-first; compute trailing averages and deltas
    for i, day in enumerate(enriched):
        # 7-day moving average (up to 7 days including this one)
        window = enriched[i:i + 7]
        day["7_day_moving_avg"] = round(
            sum(d["cost_usd"] for d in window) / len(window), 4
        )
        # Day-over-day delta (compared to previous day = next index)
        if i + 1 < len(enriched):
            day["day_over_day_delta"] = round(
                day["cost_usd"] - enriched[i + 1]["cost_usd"], 4
            )
        else:
            day["day_over_day_delta"] = None

    return {"days": enriched}


@router.get("/{agent_id}")
async def get_agent_budget(
    agent_id: str,
    limit: int = Query(default=50, le=200),
):
    """Get token usage detail for a single agent.

    Returns totals and recent events with usage data.
    """
    return conversation_store.get_agent_budget(agent_id, limit=limit)
