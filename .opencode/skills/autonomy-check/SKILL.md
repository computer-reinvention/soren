---
name: autonomy-check
description: Scan mailbox, workers, backlog, project supervisors, git, and health for actionable work in a single structured pass. Use when idle and deciding what to do next, or to understand what an incoming [HEARTBEAT] nudge's content is actually based on.
---

# Autonomy Check - Work Discovery

Feeds the supervisor autonomy engine: `monitor.sh` calls this whenever the supervisor goes idle and injects the output as a `[HEARTBEAT]` message. You can run it yourself any time you want the same "what should I do next" scan without waiting for the daemon.

## Checks, in Priority Order

1. **Mailbox** — unread messages, broken down by sender/type
2. **Workers** — active/idle counts with names
3. **Backlog** — pending items with priority breakdown
4. **Project supervisors** — health of `sup-*` agents
5. **Git** — uncommitted tracked changes
6. **Health** — the system health endpoint

## Commands

```bash
./tools/autonomy-check              # one-line-per-section summary (default)
./tools/autonomy-check --summary    # same, explicit
./tools/autonomy-check --raw        # raw JSON for programmatic use
```

**Exit code 0** = work found (something actionable in at least one section). **Exit code 1** = genuinely nothing to do — a legitimate idle state, not a failure.

## When to Use It

- You just finished a task and want to know what's next, before reaching for the backlog directly
- You received a bare `[HEARTBEAT]` nudge and want the full structured picture behind it rather than the summarized text
- Debugging why the idle-nudge loop keeps firing (or doesn't) — run it manually and compare against what the daemon logged
