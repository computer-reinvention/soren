---
name: scheduling
description: Set reminders and scheduled check-ins for future work — remind (dated reminder task) and schedule (timed check-in fired by heartbeat). Use when a task needs a future check-in, a date-based reminder, or a follow-up nudge; there is no recurring cron — both tools are one-shot.
---

# Scheduling - Reminders and Future Check-ins

Two tools, both **one-shot** (neither recurs — SOREN has no cron):

| | `tools/remind` | `tools/schedule` |
|---|---|---|
| Granularity | a **date** (YYYY-MM-DD) | **seconds** or HH:MM today |
| Storage | task in the `tasks` table (`POST /api/tasks`, tag `reminder`) | `schedule` table in `.soren/soren.db` |
| Delivered by | monitor.sh heartbeat nudges (`/api/tasks/reminders/due`) | `tools/autonomy-check` calling `schedule fire` |
| After firing | stays a task (sent-once logging via `.soren/.reminder-sent-ids`) | row deleted from the `schedule` table |
| Good for | "check the cert renewal on the 1st" | "check if worker-X finished in 30 min" |

Each tool has its own skill with the full command reference — load the `remind` skill or the `schedule` skill for the exact syntax. This skill covers the concepts shared between them: when to reach for one vs. the other, and the delivery mechanics both share.

## Delivery Mechanics — when they actually reach an agent

Neither tool interrupts anyone at the due moment. Delivery piggybacks on the **heartbeat cycle**:

- **schedule** items: `tools/autonomy-check` (run during heartbeat scans) calls `schedule fire`; due notes become a `Reminders:` finding and the scan's highest-priority line, injected into the supervisor's nudge. Fired items are deleted.
- **remind** tasks: `monitor.sh` fetches `/api/tasks/reminders/due` and appends `[REMINDER] You have N due reminder(s): ...` to heartbeat/idle nudges (monitor.sh:809-914). Duplicate delivery is suppressed via `.soren/.reminder-sent-ids`.

Consequence: delivery latency is bounded by the nudge cadence, not the due time. An idle supervisor under backoff may not see a reminder for a while; a busy supervisor sees it on its next nudge. Don't schedule anything that needs second-level precision.

## Warnings

- **Self-scheduled check-ins are a busywork vector.** Every fired item consumes a supervisor wake-up and tokens. In supervised autonomy mode (the default), schedule sparingly and prefer **backlog proposals** (`tools/backlog add`) for future work — the backlog is persistent, prioritized, and human-reviewable; a schedule note is a fire-and-forget ping.
- **Don't build recurrence by re-scheduling yourself** in a loop — that's a token-burning cron imitation. Periodic system work belongs in monitor.sh's built-in cycles or auto-maintenance.
- **schedule notes vanish after firing.** If the follow-up matters beyond one nudge, it belongs in the backlog or the tasks table, not the schedule table.
- `schedule add-at` only knows *today* (past times roll to tomorrow); for anything further out, use `remind`.
