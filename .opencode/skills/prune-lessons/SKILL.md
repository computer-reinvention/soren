---
name: prune-lessons
description: Remove stale, unconfirmed dated lessons from permanent workers' generated role files. Use during a maintenance sweep, or when system-verify flags stale lessons as a failing check.
---

# Prune Lessons - Clean Up Stale Role-File Lessons

Targets only the **`## Accumulated Knowledge` section of spawned role files** (`.soren/worker-contexts/*-role.md` — where `verify-done.sh` auto-appends dated lessons after a verified task). It does **not** touch the memory DB (`memory-index`/`extract-patterns`'s territory) or the hand-curated `templates/team/knowledge/*.md` files (the `knowledge` skill's territory) — three genuinely separate stores that are easy to conflate.

## Pruning Policy

A dated lesson (`- [YYYY-MM-DD] ...`) is pruned when it is **more than 7 days old AND has fewer than 2 confirmations**. A lesson containing `confirmed Nx` with N≥2 is kept regardless of age — re-confirming a lesson that keeps proving true is how you make it permanent.

## Commands

```bash
./tools/prune-lessons            # dry run — shows what would be pruned, changes nothing
./tools/prune-lessons --apply    # actually remove stale entries
./tools/prune-lessons --json     # machine-readable summary
```

**Always dry-run first** — review what's about to be removed before `--apply`.

## When to Use It

- `system-verify` flags stale lessons as a failing check — run this (dry-run) to see what it's referring to, then `--apply` once satisfied
- Periodic hygiene sweep on permanent workers' role files, especially ones that have accumulated a lot of one-off lessons that were never re-confirmed
- If a lesson you believe is still valid keeps getting pruned, that's a signal to re-confirm it (have the pattern extractor or a manual edit add `confirmed 2x`) rather than fighting the pruner
