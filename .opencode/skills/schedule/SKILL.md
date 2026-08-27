---
name: schedule
description: Set a short-horizon timed check-in (seconds, or a time today) fired by the heartbeat scan. Use for "check back on this in N minutes" — not for anything date-based (see the remind tool for that) or truly recurring (there is no cron here).
---

# Schedule - Short-Horizon Check-ins

Stores a one-shot check-in in the `schedule` table of `.soren/soren.db`. Fired exactly once by `tools/autonomy-check` during a heartbeat scan (atomic `UPDATE ... RETURNING`, so it can't double-fire), then the row is deleted — it does not persist as a task the way `remind` does.

## Commands

```bash
./tools/schedule add <seconds> "<note>"     # N seconds from now
./tools/schedule add-at <HH:MM> "<note>"    # a specific time today (past time rolls to tomorrow)
./tools/schedule list                       # pending items with countdowns
./tools/schedule clear [id]                 # clear one item, or all if no id given
./tools/schedule fire                       # checks for due items — called by autonomy-check, don't call manually
```

```bash
./tools/schedule add 300 "Check if worker-X finished the auth refactor"
./tools/schedule add 1800 "Review sup-todo-backend's test results"
./tools/schedule add-at 14:00 "Run full test suite before EOD"
```

## Delivery

Fires during the next `autonomy-check` heartbeat scan, not at the exact due instant — due items are injected into the supervisor's prompt as a `Reminders:` finding. `add-at` only knows *today*; for anything further out, use `remind` instead.

## Warnings

- **A busywork vector if overused** — every fired item consumes a supervisor wake-up and tokens. Schedule sparingly; a backlog proposal (`tools/backlog add`) is usually the better home for future work.
- **Don't build recurrence by re-scheduling yourself in a loop** — that's a token-burning cron imitation SOREN deliberately doesn't have.
- **Notes vanish after firing** — if the follow-up matters beyond one nudge, it belongs in the backlog or `tasks` table, not here.

## When to Use `schedule` vs. `remind`

If you're thinking in minutes/hours *today*, use this. If you're thinking in calendar days, use `remind` instead — see that skill for the comparison table.
