---
name: session-snapshot
description: Generate a machine-readable JSON snapshot of current system state (active workers, pending tasks, recent mailbox subjects, git state) for instant orientation. Use for a new supervisor's first-boot context, or right before a planned restart.
---

# Session Snapshot - JSON State Capture

Saves to `.soren/journal/supervisor/YYYY-MM-DD/session-snapshot.json` (overwrites — only the latest matters). Designed to complete in under 10 seconds so it's cheap to run often.

## Commands

```bash
./tools/session-snapshot
```

No flags. Captures:
- Active workers — from the agents API (registry + live tmux merged)
- Pending tasks — from the tasks API
- Recent mailbox subjects
- Git branch/status summary

## When to Use It

- A fresh supervisor's very first action on boot — read this JSON for instant orientation instead of piecing together state from five separate commands
- Right before a planned restart or handoff, so whoever picks up next has a clean starting point
- This is the *machine-readable* counterpart to `session-digest`'s human-readable briefing — reach for `session-digest` when you're reading it yourself right now, this when you (or another agent) need to read it back later
