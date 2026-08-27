---
name: code-health
description: Scan the SOREN codebase itself for unused imports, dead API routes, code smells, orphaned worker context files, and a TODO/FIXME inventory. Use before reporting a SOREN-codebase task done, or when auditing overall code quality.
---

# Code Health - SOREN Self-Scan

A fast (<5s) static scan of SOREN's own codebase (`src/server`, `src/frontend`, `tools`, `.soren`) — not the tool for auditing an external project.

## Checks

1. Unused Python imports in `src/server/**/*.py`
2. Dead API routes (defined in the backend but never called from `src/frontend/src/lib/api.ts`)
3. Code smells: hardcoded addresses, bare `except:`, overly long functions, duplicated literals
4. Orphaned worker context files (no matching entry in the agent registry)
5. TODO/FIXME/HACK comment inventory

## Commands

```bash
./tools/code-health           # full human-readable report
./tools/code-health --json    # JSON summary (system-verify integration)
```

## When to Use It

- Before reporting `[DONE]` on any task that touched SOREN's own backend routes — a quick check that you didn't leave a dead route or unused import behind
- Periodic hygiene pass, especially after several workers have merged changes independently
- `system-verify`/`system-audit` call this as part of their own checks — run it standalone when you want just this signal without the rest
