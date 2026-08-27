---
name: remind
description: Create a date-based reminder task, delivered via heartbeat nudges once due. Use for anything that needs a future check-in tied to a calendar date (not a short countdown — see the schedule tool for that).
---

# Remind - Date-Based Reminder Tasks

Creates a task (via `POST /api/tasks`) tagged `reminder` with a due date — it lives in the same `tasks` table normal work does (see the `tasks` skill), just with a `due_date` and the `reminder` tag marking it as one.

## Commands

```bash
./tools/remind "Rotate webhook secret" "2026-09-01"
./tools/remind "Follow up on flaky test" "2026-08-25" "tests/test_agents.py::test_spawn intermittent"
```

Requires the server running — this posts to `http://localhost:${SOREN_PORT}/api/tasks`.

## Delivery

Not interrupt-driven — `monitor.sh` fetches `/api/tasks/reminders/due` and appends `[REMINDER] You have N due reminder(s): ...` to the next heartbeat/idle nudge. Duplicate delivery is suppressed (`.soren/.reminder-sent-ids`). This means delivery latency is bounded by the nudge cadence, not the due date — an idle supervisor under backoff may not see it immediately on the due day.

## When to Use `remind` vs. `schedule`

Both are one-shot (no recurrence — SOREN has no cron):

| | `remind` (this tool) | `schedule` |
|---|---|---|
| Granularity | a calendar **date** | seconds, or HH:MM today |
| Good for | "check the cert renewal on the 1st" | "check if worker-X finished in 30 min" |

If you're thinking in days/weeks, use this. If you're thinking in minutes/hours today, use `schedule` instead.

## Don't Overuse This

Prefer a **backlog proposal** (`tools/backlog add`) for future work that isn't tied to a specific date — the backlog is persistent, prioritized, and human-reviewable, where a reminder is a fire-and-forget nudge with no priority or review step.
