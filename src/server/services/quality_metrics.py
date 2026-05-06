"""Quality-per-dollar metrics — outcome quality relative to tokens spent.

Derives all metrics from existing tables (messages, agent_events, failure_log).
No new schema required.

Key metric: completions_per_dollar — how many successful task completions does
each agent deliver per USD of token cost? Higher is better.
"""

from collections import defaultdict
from .conversation_store import conversation_store
from .budget_guard import tokens_to_usd
from .failure_log import _ensure_table as _ensure_failure_table

_EXCLUDED_AGENTS = {'user', 'test', 'system'}
_EXCLUDED_PREFIXES = ('worker-test', 'worker-budget-', 'qual-', 'test-')


def _is_excluded(agent_id: str) -> bool:
    """Return True if agent_id is noise (test/system/internal)."""
    return agent_id in _EXCLUDED_AGENTS or agent_id.startswith(_EXCLUDED_PREFIXES)


def get_agent_quality_metrics() -> dict:
    """Compute quality-per-dollar metrics for all agents.

    Returns:
        {
          "agents": [
            {
              "agent_id": str,
              "completions": int,        # task_status IN (completed, verified)
              "failures": int,           # task_status = failed
              "logged_failures": int,    # entries in failure_log table
              "total_cost_usd": float,
              "completions_per_dollar": float | None,
              "cost_per_completion_usd": float | None,
              "success_rate": float,     # completions / (completions + failures)
            }
          ],
          "summary": {
            "system_cost_per_completion_usd": float | None,
            "average_retries_per_task": float | None,
            "most_cost_effective_agent": str | None,
            "total_completions": int,
            "total_failures": int,
            "total_cost_usd": float,
          }
        }
    """
    _ensure_failure_table()

    with conversation_store._get_connection() as conn:

        # --- Per-agent completion and failure counts from messages table ---
        # "completions" = task resolved successfully (completed or verified)
        # "failures"    = task explicitly failed
        cursor = conn.execute(
            """
            SELECT
                to_agent                                        AS agent_id,
                SUM(CASE WHEN task_status IN ('completed','verified') THEN 1 ELSE 0 END)
                                                                AS completions,
                SUM(CASE WHEN task_status = 'failed'            THEN 1 ELSE 0 END)
                                                                AS failures
            FROM messages
            WHERE task_status IS NOT NULL
              AND to_agent NOT IN ('user','test','system')
              AND to_agent NOT LIKE 'worker-test%'
              AND to_agent NOT LIKE 'worker-budget-%'
              AND to_agent NOT LIKE 'qual-%'
              AND to_agent NOT LIKE 'test-%'
            GROUP BY to_agent
            """
        )
        task_counts: dict[str, dict] = {}
        for row in cursor.fetchall():
            task_counts[row["agent_id"]] = {
                "completions": row["completions"] or 0,
                "failures":    row["failures"]    or 0,
            }

        # --- Per-agent token costs from agent_events ---
        # Usage values are CUMULATIVE session totals — use only the latest
        # event per agent to avoid multiplying prior-turn counts.
        cursor = conn.execute(
            """
            SELECT
                agent_id,
                json_extract(usage, '$.input_tokens')              AS input_tokens,
                json_extract(usage, '$.output_tokens')             AS output_tokens,
                json_extract(usage, '$.cache_read_input_tokens')   AS cache_read,
                json_extract(usage, '$.cache_creation_input_tokens') AS cache_write
            FROM (
                SELECT *,
                    ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY timestamp DESC) as rn
                FROM agent_events
                WHERE usage IS NOT NULL
                  AND agent_id NOT IN ('user','test','system')
                  AND agent_id NOT LIKE 'worker-test%'
                  AND agent_id NOT LIKE 'worker-budget-%'
                  AND agent_id NOT LIKE 'qual-%'
                  AND agent_id NOT LIKE 'test-%'
            )
            WHERE rn = 1
            """
        )
        agent_costs: dict[str, float] = {}
        for row in cursor.fetchall():
            agent_costs[row["agent_id"]] = tokens_to_usd(
                row["input_tokens"]  or 0,
                row["output_tokens"] or 0,
                row["cache_read"]    or 0,
                row["cache_write"]   or 0,
            )

        # --- Per-agent failure_log counts (logged failures from monitor/agents) ---
        cursor = conn.execute(
            "SELECT agent_id, COUNT(*) AS cnt FROM failure_log GROUP BY agent_id"
        )
        logged_failures: dict[str, int] = {
            row["agent_id"]: row["cnt"] for row in cursor.fetchall()
        }

        # --- Per-agent first-pass success counts ---
        # A "first-pass success" is a verified message where the agent has NO
        # [FIX-REQUEST] messages between the task assignment and verification.
        cursor = conn.execute(
            """
            SELECT
                to_agent AS agent_id,
                SUM(CASE WHEN task_status = 'verified' THEN 1 ELSE 0 END) AS total_verified,
                SUM(CASE
                    WHEN task_status = 'verified' AND NOT EXISTS (
                        SELECT 1 FROM messages m2
                        WHERE m2.to_agent = messages.to_agent
                          AND m2.content LIKE '%[FIX-REQUEST]%'
                          AND m2.timestamp < messages.timestamp
                          AND m2.timestamp > COALESCE(
                              (SELECT MAX(m3.timestamp) FROM messages m3
                               WHERE m3.to_agent = messages.to_agent
                                 AND m3.content LIKE '[TASK]%'
                                 AND m3.timestamp < messages.timestamp),
                              '1970-01-01'
                          )
                    ) THEN 1 ELSE 0 END
                ) AS first_pass_successes
            FROM messages
            WHERE task_status IS NOT NULL
            GROUP BY to_agent
            """
        )
        first_pass_data: dict[str, dict] = {}
        for row in cursor.fetchall():
            first_pass_data[row["agent_id"]] = {
                "total_verified": row["total_verified"] or 0,
                "first_pass_successes": row["first_pass_successes"] or 0,
            }

    # --- Merge all agents seen across any data source ---
    all_agent_ids = (
        set(task_counts) | set(agent_costs) | set(logged_failures)
    )

    # Filter out noise agents
    all_agent_ids = {
        aid for aid in all_agent_ids
        if not _is_excluded(aid)
    }

    agents = []
    for agent_id in sorted(all_agent_ids):
        tc    = task_counts.get(agent_id, {"completions": 0, "failures": 0})
        cost  = agent_costs.get(agent_id, 0.0)
        lf    = logged_failures.get(agent_id, 0)
        fp    = first_pass_data.get(agent_id, {"total_verified": 0, "first_pass_successes": 0})

        completions = tc["completions"]
        failures    = tc["failures"]
        total_tasks = completions + failures

        success_rate = round(completions / total_tasks, 4) if total_tasks > 0 else 0.0

        completions_per_dollar  = round(completions / cost, 4) if cost > 0 and completions > 0 else None
        cost_per_completion_usd = round(cost / completions, 6) if completions > 0 else None

        total_verified       = fp["total_verified"]
        first_pass_successes = fp["first_pass_successes"]
        first_pass_rate      = round(first_pass_successes / total_verified, 4) if total_verified > 0 else None

        # Skip zero-activity noise entries
        if completions == 0 and failures == 0 and cost == 0.0:
            continue

        agents.append({
            "agent_id":               agent_id,
            "completions":            completions,
            "failures":               failures,
            "logged_failures":        lf,
            "total_cost_usd":         round(cost, 6),
            "completions_per_dollar": completions_per_dollar,
            "cost_per_completion_usd": cost_per_completion_usd,
            "success_rate":           success_rate,
            "first_pass_successes":   first_pass_successes,
            "first_pass_rate":        first_pass_rate,
        })

    # --- System-wide summary ---
    total_completions = sum(a["completions"]    for a in agents)
    total_failures    = sum(a["failures"]       for a in agents)
    total_logged      = sum(a["logged_failures"] for a in agents)
    total_cost        = sum(a["total_cost_usd"] for a in agents)

    system_cost_per_completion = (
        round(total_cost / total_completions, 6)
        if total_completions > 0 else None
    )
    # average retries: logged failures are usually retry attempts before completion
    average_retries_per_task = (
        round(total_logged / total_completions, 4)
        if total_completions > 0 else None
    )

    # Most cost-effective = highest completions_per_dollar (exclude None)
    ranked = [a for a in agents if a["completions_per_dollar"] is not None]
    most_cost_effective = (
        max(ranked, key=lambda a: a["completions_per_dollar"])["agent_id"]
        if ranked else None
    )

    # System-wide first-pass rate
    total_first_pass = sum(a["first_pass_successes"] for a in agents)
    total_verified   = sum(
        first_pass_data.get(a["agent_id"], {}).get("total_verified", 0)
        for a in agents
    )
    system_first_pass_rate = (
        round(total_first_pass / total_verified, 4)
        if total_verified > 0 else None
    )

    return {
        "agents": agents,
        "summary": {
            "total_completions":             total_completions,
            "total_failures":                total_failures,
            "total_cost_usd":                round(total_cost, 6),
            "system_cost_per_completion_usd": system_cost_per_completion,
            "average_retries_per_task":       average_retries_per_task,
            "most_cost_effective_agent":      most_cost_effective,
            "system_first_pass_rate":         system_first_pass_rate,
        },
    }


def get_agent_quality_detail(agent_id: str) -> dict | None:
    """Return full quality metrics for a single agent, or None if unknown."""
    report = get_agent_quality_metrics()
    match = next((a for a in report["agents"] if a["agent_id"] == agent_id), None)
    if match is None:
        return None
    return {"agent": match, "summary": report["summary"]}
