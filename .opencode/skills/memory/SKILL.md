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

## The Three Tools

Each has its own skill with the full command reference — load whichever is relevant:

- **`memory-index`** skill — chunks journal.md/artifacts into the memories table. Runs automatically ~every 50s; manual runs are for backfills and new projects.
- **`extract-patterns`** skill — mines commits + journal sections for pattern-type memories. Runs hourly automatically.
- **`prune-lessons`** skill — removes stale role-file lessons (a *different* store from the memories table — don't confuse the two).

## Memory vs Knowledge — Which One?

| | `memory` (this skill) | `knowledge` skill |
|---|---|---|
| Written by | pipeline, automatically | agents, deliberately |
| Storage | `memories` table in `.soren/soren.db` (gitignored) | `templates/team/knowledge/*.md` (repo-tracked) |
| Scope | system-wide, cross-project | per-role |
| Read via | semantic search API | `knowledge show` / spawn injection |
| Survives rollback | yes (DB restored from backup) | yes (git) |

Rule of thumb: **query memory** to discover prior work; **write knowledge** to make a lesson part of a role.
