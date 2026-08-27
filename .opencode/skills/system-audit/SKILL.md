---
name: system-audit
description: Comprehensive health check across daemons, endpoints, budget, journal system, and (with --full) the test suite and typecheck, with HEALTHY/WARN/BROKEN verdicts. Use for a deeper system-wide check than the basic health endpoint, especially before reporting a system-level task done.
---

# System Audit - Comprehensive Health Report

Broader than `system-verify` (which checks infrastructure *exists*) — this checks whether the running system is actually *healthy*, with granular per-area verdicts.

## Commands

```bash
./tools/system-audit                # full report (excluding expensive checks)
./tools/system-audit --quick         # core checks only: health, daemons, budget, server
./tools/system-audit --full          # adds expensive checks: pytest, frontend typecheck
./tools/system-audit --json          # machine-readable
./tools/system-audit --save          # write JSON to .soren/journal/supervisor/<date>/artifacts/system-audit.json
./tools/system-audit --brief         # one-line summary: "SOREN vX: N ok, N warn, N broken — STATUS"
```

Flags compose: `--full --json --save` is a common combination for a scheduled deep audit you want archived.

## When to Use It

- `--quick` as a fast "is anything obviously wrong" check — cheap enough to run often
- `--full` before crediting a significant SOREN-codebase change as verified — it's the closest thing to "run everything"
- `--brief` when you just need the one-line verdict for a status message or dashboard note
- `--save` when you want the result preserved for later reference (recurring-issue tracking, comparing audits over time) rather than just printed and lost
