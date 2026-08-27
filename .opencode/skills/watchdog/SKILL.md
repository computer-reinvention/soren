---
name: watchdog
description: Detect agents stuck in error loops, crash states, git conflicts, or resource exhaustion via tmux pane heuristics, and optionally auto-recover them. Use when an agent seems unresponsive or you suspect it's looping.
---

# Watchdog - Stuck Agent Detection

Scans agent tmux panes for patterns that indicate trouble, rather than waiting for a timeout or a human to notice.

## Detection Patterns

| Pattern | What it catches |
|---|---|
| Process exit | opencode process no longer running in that window |
| Error loops | the same output line repeated more than 5 times |
| Git conflicts | merge conflict markers/state |
| Resource exhaustion | disk full, out of memory |
| Rate limiting | API rate limit messages |

Note: permission/plan-approval stuck states from the Claude-Code era **cannot** occur here — agents run opencode with `OPENCODE_PERMISSION` allow-all, so that whole failure class doesn't apply.

## Commands

```bash
./tools/watchdog scan            # scan every agent, report findings
./tools/watchdog scan --fix      # scan and auto-recover where possible
./tools/watchdog check <window>  # check one specific agent window
```

**Exit 0** = stuck agents found (or fixed). **Exit 1** = everyone healthy.

## When to Use It

- An agent hasn't produced output in a while and you're not sure if it's thinking, stuck, or dead — `watchdog check <window>` is faster than eyeballing a raw `tmux capture-pane`
- Before escalating "this worker seems broken" to a kill/respawn decision, let `watchdog scan --fix` attempt the cheap auto-recovery paths first
- Routine health sweep across the whole fleet — `watchdog scan` with no `--fix` to just see what's flagged before deciding what to do about it
