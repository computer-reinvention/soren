import json
from collections import defaultdict

from fastapi import APIRouter, HTTPException

from ..config import settings
from ..services import db
from ..services import quality_metrics as qm

router = APIRouter()

_COMPACT_EFFECTIVENESS_FILE = settings.soren_dir / ".compact-effectiveness"


@router.get("/quality")
async def get_quality_metrics():
    """Quality-per-dollar report for all agents.

    Returns per-agent completions, failures, cost, and efficiency ratios
    alongside system-wide summary metrics.
    """
    return qm.get_agent_quality_metrics()


@router.get("/quality/duration")
async def get_task_duration_stats():
    """Per-agent average task duration in seconds.

    Derived from the duration_seconds column on completed tasks.
    """
    conn = db.connect()
    try:
        if not db.table_exists(conn, "tasks"):
            return {"agents": {}, "overall_avg": None}
        # Check if duration_seconds column exists
        cols = [r[1] for r in conn.execute("PRAGMA table_info(tasks)").fetchall()]
        if "duration_seconds" not in cols:
            return {"agents": {}, "overall_avg": None}

        rows = conn.execute(
            "SELECT assigned_to, "
            "  COUNT(*) as task_count, "
            "  AVG(duration_seconds) as avg_duration, "
            "  MIN(duration_seconds) as min_duration, "
            "  MAX(duration_seconds) as max_duration "
            "FROM tasks "
            "WHERE duration_seconds IS NOT NULL AND length(assigned_to) > 0 "
            "GROUP BY assigned_to "
            "ORDER BY avg_duration"
        ).fetchall()

        agents = {}
        for row in rows:
            agents[row["assigned_to"]] = {
                "task_count": row["task_count"],
                "avg_seconds": round(row["avg_duration"]),
                "min_seconds": row["min_duration"],
                "max_seconds": row["max_duration"],
            }

        overall = conn.execute(
            "SELECT AVG(duration_seconds) as avg FROM tasks WHERE duration_seconds IS NOT NULL"
        ).fetchone()

        return {
            "agents": agents,
            "overall_avg": round(overall["avg"]) if overall and overall["avg"] else None,
        }
    finally:
        conn.close()


@router.get("/quality/compaction")
async def get_compaction_effectiveness():
    """Compaction effectiveness summary from JSONL records.

    Returns per-agent stats: count, avg reduction %, avg pre/post tokens.
    """
    if not _COMPACT_EFFECTIVENESS_FILE.exists():
        return {"agents": {}, "total_compactions": 0}

    records: list[dict] = []
    for line in _COMPACT_EFFECTIVENESS_FILE.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            continue

    if not records:
        return {"agents": {}, "total_compactions": 0}

    by_agent: dict[str, list[dict]] = defaultdict(list)
    for rec in records:
        by_agent[rec["agent"]].append(rec)

    agents = {}
    for agent, recs in sorted(by_agent.items()):
        avg_pre = sum(r["pre_tokens"] for r in recs) / len(recs)
        avg_post = sum(r["post_tokens"] for r in recs) / len(recs)
        avg_reduction = sum(r.get("reduction_pct", 0) for r in recs) / len(recs)
        agents[agent] = {
            "count": len(recs),
            "avg_pre_tokens": round(avg_pre),
            "avg_post_tokens": round(avg_post),
            "avg_reduction_pct": round(avg_reduction, 1),
        }

    return {
        "agents": agents,
        "total_compactions": len(records),
    }


@router.get("/quality/{agent_id}")
async def get_agent_quality(agent_id: str):
    """Quality-per-dollar detail for a single agent."""
    result = qm.get_agent_quality_detail(agent_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"No data for agent '{agent_id}'")
    return result
