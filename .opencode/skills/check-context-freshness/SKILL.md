---
name: check-context-freshness
description: Detect stale or orphaned worker role-context files — a context whose referenced source files changed after it was written, or whose agent's tmux window no longer exists. Use when a worker seems to be acting on outdated instructions, or as part of a health sweep.
---

# Check Context Freshness

Every generated worker role file (`.soren/worker-contexts/<name>-role.md` or `<name>-context.md`) captures a project's tech stack/structure at generation time. Code moves on; the context file doesn't update itself. This finds the drift.

## How It Works

1. Extracts file/directory paths referenced inside each context file
2. Compares the context file's mtime against those referenced sources' mtimes
3. **STALE**: a referenced source is more than 24h newer than the context
4. **ORPHANED**: the named agent has no tmux window in any soren session
5. **FRESH**: otherwise

## Commands

```bash
./tools/check-context-freshness                # full report
./tools/check-context-freshness --json         # machine-readable (system-verify integration)
./tools/check-context-freshness --stale-only   # only STALE/ORPHANED entries
```

## When to Use It

- A worker keeps referencing file paths or conventions that don't match the current codebase — check if its context is STALE before assuming the worker itself is confused
- Periodic hygiene sweep to find ORPHANED context files left behind after a worker was killed without cleanup (normally `auto-maintenance` handles this, but this catches anything it missed)
- Before regenerating a permanent worker's role with `workers-init-role`, check whether the existing one is actually stale first — no need to regenerate a FRESH one
