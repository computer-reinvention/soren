---
name: extract-patterns
description: Mine commit messages and journal sections for reusable conventions and lessons, storing them as pattern-type memories. Use after a batch of commits you suspect contain durable lessons, or to backfill pattern extraction across history.
---

# Extract Patterns - Mine Commits & Journal for Conventions

Scans commit messages for convention keywords (always/never/prefer/lesson/...), structural file patterns, and journal `##` sections, storing hits as `source_type: pattern` memories. Runs hourly from the monitor loop (guarded by a 50-minute marker) — manual runs are for backfills or immediate extraction.

## Commands

```bash
./tools/extract-patterns                    # today's journal + last 5 commits (default)
./tools/extract-patterns --commits 20       # last N commits instead of 5
./tools/extract-patterns --date 2026-08-19  # one journal date only
./tools/extract-patterns --all              # every journal date + last 20 commits
```

Also exposed as `POST /api/memory/extract-patterns` for programmatic triggering.

## When to Run Manually

- Just landed a batch of commits with real lessons in the messages (a bug fix explaining *why*, a convention decision) and want them searchable before the next hourly pass
- Backfilling pattern extraction across a project's full history (`--all`) after onboarding it
- Investigating why a lesson you know you wrote doesn't show up in memory search — run this and check its output for whether the keyword heuristic actually matched your phrasing

## See Also

The `memory` skill covers the full pipeline (this tool + `memory-index` + the search API) and explains how pattern-type memories relate to journal/artifact memories and to the hand-curated `knowledge` skill.
