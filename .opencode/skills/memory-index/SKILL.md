---
name: memory-index
description: Index journal entries and artifacts into the semantic memory store so they're findable by /api/memory/search. Use for backfilling history, indexing a newly-registered project, or right after writing an artifact you want searchable immediately.
---

# Memory Index - Index Journals & Artifacts

Chunks each scope's `journal.md` by `##` headers and indexes `artifacts/*.md`, writing to the `memories` table in `.soren/soren.db` (source_type `journal` / `artifact`). Runs automatically from the monitor loop roughly every 50 seconds — manual runs are for backfills and immediate indexing, not routine use.

For self (SOREN's own journal), this walks both the supervisor scope and every team scope (see the `journal` skill's scoping model) — you don't need to specify which.

## Commands

```bash
./tools/memory-index                       # today + yesterday, self project (default)
./tools/memory-index --date 2026-08-19     # one specific date
./tools/memory-index --all                 # every date, full backfill
./tools/memory-index --project <id>        # one external project (journal, or docs fallback if none)
./tools/memory-index --all-projects        # every active project in projects.json
./tools/memory-index --with-patterns       # also run extract-patterns after (self mode only)
```

## When to Run Manually

- Just registered a new project (`soren-init`/`projects add`) — `--project <id>` to get its history searchable right away rather than waiting
- Wrote a significant artifact and want it in semantic search immediately, not on the next ~50s cycle
- Restored from backup or did a bulk journal edit — `--all` to reindex everything, safe to re-run (dedupes by `source_path + content_hash`)

## See Also

The `memory` skill covers the full pipeline (this tool + `extract-patterns` + the search API + how memory differs from the `knowledge` skill) — read that for the conceptual picture; this skill is the quick command reference for this one tool.
