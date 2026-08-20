---
name: memory
description: Search and maintain the automatic semantic memory pipeline — memory index, extract patterns, prune lessons, and the memory store (memories table in .soren/soren.db). Use when searching past work before starting a similar task, running memory-index or extract-patterns manually, or pruning stale worker lessons.
---

# Memory - Automatic Semantic Memory Pipeline

Memory is the **automatic** pipeline that turns journals, artifacts, and commits into a searchable vector store. It differs from the `knowledge` skill: knowledge files are *per-role, hand-curated, git-versioned*; memory is *system-wide, automatic, and lives in the gitignored consolidated SQLite DB* (the `memories` table of `.soren/soren.db`, fastembed BAAI/bge-small-en-v1.5, 384-dim vectors, cosine similarity — see `src/server/services/memory_store.py`).

## Pipeline

```
journals + artifacts ──► tools/memory-index (monitor.sh, every ~50s) ──┐
                                                                        ├──► soren.db (memories) ──► POST /api/memory/search
commits + journals ────► tools/extract-patterns (monitor.sh, hourly) ──┘        (semantic search)
```

- `memory-index` chunks `journal.md` by `##` headers and indexes `artifacts/*.md` (source_type `journal` / `artifact`; external projects fall back to README/AGENTS.md/docs as `documentation`)
- `extract-patterns` mines commit messages (convention keywords: always/never/prefer/lesson...), structural file patterns, and journal sections into source_type `pattern` entries (`src/server/services/pattern_extractor.py`)
- Everything dedupes by `source_path + content_hash` — re-running is always safe

## Query Before Starting Similar Work

The record beats guesswork. Before assessing an approach, search for prior work:

```bash
curl -sf -X POST http://localhost:8000/api/memory/search \
  -H "Content-Type: application/json" \
  -d '{"query": "websocket reconnect flakiness", "limit": 5}' | jq '.results[] | {score, source_type, source_path, content}'
```

- `project_id` restricts to one project; omit it to search all projects
- `GET /api/memory/stats` — totals by source_type and project
- Results include `source_path` — read the original journal/artifact when a hit looks relevant

## CLI Reference

### memory-index

```bash
./tools/memory-index                       # index SOREN journal, today + yesterday (default)
./tools/memory-index --date 2026-08-19    # one specific date
./tools/memory-index --all                 # all journal dates
./tools/memory-index --project <id>        # one project (journal, or docs fallback)
./tools/memory-index --all-projects        # every active project in projects.json
./tools/memory-index --with-patterns       # also run extract-patterns after (self mode only)
```

Runs automatically from the monitor loop (`src/orchestrator/monitor.sh:1691`), so manual runs are only needed for backfills (`--all`) and new projects.

### extract-patterns

```bash
./tools/extract-patterns                   # today's journal + last 5 commits
./tools/extract-patterns --commits 20      # last N commits
./tools/extract-patterns --date 2026-08-19 # one journal date only
./tools/extract-patterns --all             # all journal dates + last 20 commits
```

Runs hourly from the monitor loop (`monitor.sh:1729`, guarded by a 50-minute marker). Also exposed as `POST /api/memory/extract-patterns`.

### prune-lessons

Prunes stale dated lessons from the **`## Accumulated Knowledge` sections of spawned role files** (`.soren/worker-contexts/*-role.md` — the entries verify-done auto-appends). It does not touch the memory DB or `templates/team/knowledge/`.

```bash
./tools/prune-lessons            # dry run: shows what would be pruned
./tools/prune-lessons --apply    # remove stale entries
./tools/prune-lessons --json     # machine-readable summary
```

**Pruning policy** (from the code): a lesson is pruned when it is **>7 days old AND has fewer than 2 confirmations**. A lesson containing `confirmed Nx` with N≥2 is kept regardless of age — so re-confirm lessons that keep proving true. `tools/system-verify` flags stale lessons as a failing check.

## Memory vs Knowledge — Which One?

| | `memory` (this skill) | `knowledge` skill |
|---|---|---|
| Written by | pipeline, automatically | agents, deliberately |
| Storage | `memories` table in `.soren/soren.db` (gitignored) | `templates/team/knowledge/*.md` (repo-tracked) |
| Scope | system-wide, cross-project | per-role |
| Read via | semantic search API | `knowledge show` / spawn injection |
| Survives rollback | yes (DB restored from backup) | yes (git) |

Rule of thumb: **query memory** to discover prior work; **write knowledge** to make a lesson part of a role.
