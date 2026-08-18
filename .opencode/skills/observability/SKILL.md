---
name: observability
description: Add structured logging, meaningful health checks, and metrics that matter while avoiding alert fatigue. Load when adding logging, debugging production issues, or building monitoring.
---

# Observability

You can't fix what you can't see. Observability is designing, in advance, the evidence trail you'll need at 3am — because you won't get to add logging *after* the incident.

## Structured Logging

- Log **events with fields**, not prose: `{"event": "task_assigned", "task_id": 42, "agent": "perm-backend", "duration_ms": 130}` — grep-able, jq-able, aggregatable. Prose logs ("assigned the task to Kai") die in the first `jq` pipeline.
- Every log line carries: timestamp (UTC), level, event name, and the **correlation ID** (task ID, agent name, request ID) that lets you trace one flow through the system. A log you can't correlate is trivia.
- Levels mean things: `ERROR` = someone should look; `WARN` = degraded but self-handled; `INFO` = state transitions worth reconstructing later; `DEBUG` = development detail, off by default. If everything is ERROR, nothing is.
- Log at **decision points and boundaries**: request in/out, task state changes, retries, fallbacks, giving up. Not inside tight loops.
- Never log secrets, tokens, or full request bodies with credentials. Truncate huge payloads (log length + hash, not 2MB of JSON).

## Health Checks

- A health check answers "can this service do its job **right now**" — not "is the process alive". `return {"ok": true}` without touching dependencies is a liveness stub, not a health check.
- Readiness should verify critical dependencies cheaply: DB reachable (one trivial query), mailbox writable, tmux session present. Report per-dependency status so the check *localizes* the failure:
  `{"status": "degraded", "db": "ok", "tmux": "ok", "mailbox": "fail: EACCES"}`
- Keep it fast (<1s) and side-effect-free — SOREN's monitor polls `/api/webhooks/health` every few seconds and rolls back on repeated failure; a slow or flaky health check *causes* incidents.
- Distinguish "starting up" from "broken" — a restart loop caused by failing health during warmup is self-inflicted.

## Metrics That Matter

Four golden signals cover most services:

1. **Latency** (p50/p95/p99 — averages hide the pain)
2. **Traffic** (requests/tasks per minute)
3. **Errors** (rate, by type)
4. **Saturation** (queue depth, DB size, disk, open connections)

- For a task system like SOREN, the ones that predict trouble: mailbox queue depth, task time-to-completion, worker idle vs stuck time, rollback count, heartbeat staleness.
- Prefer counters and gauges you can derive questions from ("how many retries this hour") over vanity numbers ("total messages ever").
- Every metric needs a consumer. A metric nobody queries is logging with extra steps.

## Alert Fatigue

- Alert on **symptoms users feel** (health check failing, task pipeline stalled), not on causes (CPU 80%). Causes make good dashboards, bad pagers.
- Every alert must be: actionable (a human can do something), urgent (it can't wait), and rare enough to stay meaningful. An alert that fires daily and gets ignored is training people to ignore alerts.
- Tune with the rule: after each alert, ask "did anyone act?" Three no's in a row → demote it to a dashboard or delete it.
- Batch/deduplicate: one incident should page once, not 40 times as each poller notices.

## Checklist

1. New feature: what question will I ask when this breaks? Is the log line that answers it already there?
2. Log lines structured, leveled, correlated; no secrets.
3. Health checks verify dependencies and localize failure; fast and side-effect-free.
4. At least one saturation signal exists for any new queue/store.
5. New alerts pass the actionable/urgent/rare test.

## Anti-Patterns

- `print()` debugging left in as "logging".
- Logging the error but swallowing it (`except: log; pass`) — now it fails *silently with receipts*.
- Health checks that cache "ok" or depend on the thing they're supposed to detect failing.
- One log line per loop iteration in the hot path.
- Alerting on every ERROR log line — errors are data; alerts are demands for a human.
