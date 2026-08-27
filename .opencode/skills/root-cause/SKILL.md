---
name: root-cause
description: Analyze a commit's diff against recent error logs to identify the likely cause of a server failure. Use after a health-check failure or auto-rollback, before deciding on a fix.
---

# Root Cause - Failure Diagnosis

A diagnostic tool, not a gate — it always exits 0 and never blocks recovery. It correlates *what changed* (a commit's diff) against *what broke* (recent error logs) to suggest where to look first.

## Commands

```bash
./tools/root-cause                                  # analyze HEAD against recent logs
./tools/root-cause --commit <sha>                   # analyze a specific commit
./tools/root-cause --error-log <file>               # use a specific error log instead of the default
```

## Output

- **stdout**: JSON result — machine-readable, consumed by `monitor.sh` and the failure log
- **stderr**: human-readable summary — read this when running interactively

## When to Use It

- Right after an auto-rollback fires (per `recovery-ops`), before you start guessing — this narrows the search to the commit that was live when things broke
- A health check started failing and you're not sure which of several recent commits is responsible
- Triaging a `system-verify`/`system-audit` failure that doesn't have an obvious cause from the check output alone

This complements `postmortem` (which produces a full narrative report for a specific reverted commit) — reach for `root-cause` first to *find* the likely commit, then `postmortem` to write up *why* it failed once you know.
