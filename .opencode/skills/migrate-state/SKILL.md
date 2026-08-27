---
name: migrate-state
description: One-time consolidation of legacy per-domain SQLite databases (tasks.db, conversations.db, agent_registry.db, auth.db, memories.db) into the single .soren/soren.db. Use only if you find leftover legacy DB files that still need migrating.
---

# Migrate State - Legacy DB Consolidation

Already run on every up-to-date SOREN install — `.soren/soren.db` is the single consolidated database everything else in this system assumes exists. You'll only touch this tool if you find stray legacy files, or you're testing the migration path itself.

## What `run` Does

1. Refuses to run if the `soren` tmux session exists or the server answers on port 8000 — **cutover requires a stopped system** (unless `--force` or `--sandbox`)
2. Creates `soren.db` (WAL mode) if it doesn't exist
3. For each legacy DB found (`tasks.db`, `conversations.db`, `agent_registry.db`, `auth.db`, `memories.db`, in that order): copies schema (`CREATE TABLE IF NOT EXISTS`, tolerant of collisions), then `INSERT OR IGNORE`s rows into the matching table in `soren.db`
4. Moves the now-migrated legacy files to `.soren/backup-pre-consolidation/<timestamp>/` — nothing is deleted outright

## Commands

```bash
./tools/migrate-state              # run the migration (default action)
./tools/migrate-state status       # report legacy DBs found + row counts vs soren.db, no changes
./tools/migrate-state run --force  # skip the running-system safety gate — dangerous, only if you know why
./tools/migrate-state run --sandbox <dir>     # operate on a COPIED .soren dir, for testing
./tools/migrate-state status --sandbox <dir>
```

## When You'd Actually Use This

- `status` to confirm there's nothing left to migrate (the normal case — should report zero legacy DBs)
- After restoring an old backup/checkout that predates the consolidation, before starting the system on it
- Testing changes to the migration logic itself — always via `--sandbox`, never against the live `.soren/`

## Safety

- Never run `run` (without `--sandbox`) against a live, running system except through the documented stop-first flow — the running-system gate exists because a mid-flight migration against an active DB is how you get corruption, not the good kind of consolidation.
