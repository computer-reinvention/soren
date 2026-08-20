---
name: data-wrangling
description: jq and sqlite3 patterns for inspecting SOREN's runtime state - registries, databases, mailbox, and safe mutation discipline.
---

# Data Wrangling (jq + sqlite3)

SOREN's runtime state lives in one SQLite database (`.soren/soren.db`) plus
regenerated JSON views and a few file-based stores under `.soren/`.
These are production data — read freely, mutate only through the tools.

## jq essentials

The registry JSONs (`agent_registry.json`, `projects.json`, `teams.json`) are
**read-only views** regenerated from `soren.db` tables — read them freely with
jq, never edit them by hand:

```bash
jq -r '.supervisor.oc_port' .soren/agent_registry.json
jq -r 'to_entries[] | select(.value.permanent == true) | .key' .soren/agent_registry.json
jq -r '[.teams[].prefix] | @tsv' .soren/teams.json
jq -Rs .                          # safely JSON-encode arbitrary text (for curl bodies)
jq -cn --arg t "$text" '{text: $t}'   # build payloads from shell vars — NEVER string-interpolate
```

Registry mutation goes through the sqlite-master helper, which writes the
`agents` table and regenerates the JSON view atomically:
```bash
source tools/lib/opencode.sh
soren_registry_update .soren/agent_registry.json --arg k name '.[$k].field = "value"'
# never edit the view file directly — the next regeneration overwrites it
```

## sqlite3 essentials

All tables are in the single consolidated DB. From shell scripts, source
`tools/lib/db.sh` and use `soren_db` (adds the project-wide 5s busy timeout);
interactively, plain `sqlite3 .soren/soren.db` works too:

```bash
sqlite3 .soren/soren.db ".schema agent_events"
sqlite3 .soren/soren.db "SELECT event_type, agent_id FROM agent_events ORDER BY timestamp DESC LIMIT 10"
sqlite3 .soren/soren.db "SELECT id, status, assigned_to FROM tasks WHERE status='in-progress'"
sqlite3 -json .soren/soren.db "SELECT ..."       # JSON output, pipe to jq
```

Key tables: `tasks` (+ `task_dependencies`, `task_status_history`),
`messages`, `agent_events`, `thoughts`, `agents` (registry master), `users`,
`memories`, `secrets_vault`, `fix_retries`, `verify_events`, `spawn_events`,
`compact_timestamps`, `projects`, `teams`, `schedule`, `prefs`.
(The legacy per-domain DBs — tasks.db, conversations.db, agent_registry.db,
auth.db, memories.db — were consolidated by `tools/migrate-state`; the old
files live in `.soren/backup-pre-consolidation/<timestamp>/`.)

## Safety discipline

- Escape single quotes when interpolating into SQL: `v="${v//\'/''}"` —
  better, pass data through the server API or tools instead.
- WAL sidecars (`soren.db-shm`, `soren.db-wal`) belong to the live system —
  never delete them while anything runs.
- Schema creation is `CREATE TABLE IF NOT EXISTS` everywhere — tools and the
  server initialize missing tables on first touch; never create tables by
  hand.
- Mailbox is append-only JSONL via `tools/mailbox` — never edit lines.

## Anti-patterns

- `jq ... file > file` (truncates the input before reading).
- String-building JSON or SQL from unsanitized variables.
- Hand-editing `agent_registry.json`/`projects.json`/`teams.json` — they are
  regenerated views; direct edits are overwritten (and never propagate back
  to the `soren.db` master).
