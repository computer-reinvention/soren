---
name: auto-maintenance
description: Understand (or manually trigger) the periodic cleanup daemon that kills stale workers, prunes orphaned context files, and resets/retires idle workers. Use when investigating why a worker disappeared or reset unexpectedly, or to run cleanup on demand.
---

# Auto-Maintenance - Periodic Cleanup

Runs automatically every 5 minutes via `monitor.sh`. You'll rarely invoke this yourself, but you'll often need to understand *why* it did something to a worker you were counting on.

## What It Does, in Order

1. **Kills idle workers** — no context-file activity for 30+ minutes (`WORKER_IDLE_THRESHOLD`, default 1800s)
2. **Removes orphaned context files** — a `worker-contexts/*.md` file for a tmux window that no longer exists
3. **Proactively resets IDLE permanent workers** — after `SOREN_RESET_TASKS` completed tasks or `SOREN_RESET_HOURS` since last reset (context resets are the tradeoff permanent workers make for specialization — see the `knowledge` skill for how they survive it)
4. **Retires sleeping ephemeral workers** — after `SOREN_RETIRE_SLEEPING_HOURS` (24h default), archiving their conversation first

## Safety Guarantee

**Never touches**: `supervisor`, any project supervisor (`sup-*`), the sentry, or the `monitor` window itself. Only ordinary workers are in scope — if a system-level agent vanished, this isn't why; check `watchdog` or the daemon logs instead.

## Manual Invocation

```bash
./tools/auto-maintenance
```

Useful right after you notice a worker is unexpectedly gone or reset — running it manually reproduces exactly what the next scheduled pass would do, so you can see the reasoning in its output rather than waiting for the next cycle.

## Debugging "Why Did My Worker Disappear?"

1. Check `.soren/orchestrator.log` around the time it vanished for an `auto-maintenance` log line
2. If it was idle 30+ min with no context-file writes, that's the idle-kill — not a bug
3. If it was a permanent worker and reset (not killed), check its knowledge file and journal survived — that's the expected reset behavior, not data loss
