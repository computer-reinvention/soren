---
name: data-wrangling
description: jq and sqlite3 patterns for inspecting SOREN's runtime state - registries, databases, mailbox, and safe mutation discipline.
---

# Data Wrangling (jq + sqlite3)

SOREN's runtime state is JSON files and SQLite databases under `.soren/`.
These are production data — read freely, mutate only through the tools.

## jq essentials

```bash
jq -r '.supervisor.oc_port' .soren/agent_registry.json
jq -r 'to_entries[] | select(.value.permanent == true) | .key' .soren/agent_registry.json
jq -r '[.teams[].prefix] | @tsv' .soren/teams.json
jq -Rs .                          # safely JSON-encode arbitrary text (for curl bodies)
jq -cn --arg t "$text" '{text: $t}'   # build payloads from shell vars — NEVER string-interpolate
```

Mutation pattern (atomic, and use the flock'd helper when available):
```bash
source tools/lib/opencode.sh
soren_registry_update .soren/agent_registry.json --arg k name '.[$k].field = "value"'
# raw fallback: jq '...' f.json > tmp && mv tmp f.json   (never jq in-place)
```

## sqlite3 essentials

```bash
sqlite3 .soren/conversations.db ".schema agent_events"
sqlite3 .soren/conversations.db "SELECT event_type, agent_id FROM agent_events ORDER BY timestamp DESC LIMIT 10"
sqlite3 .soren/tasks.db "SELECT id, status, assigned_to FROM tasks WHERE status='in-progress'"
sqlite3 -json .soren/tasks.db "SELECT ..."       # JSON output, pipe to jq
```

Key databases: `conversations.db` (messages, agent_events), `tasks.db`,
`agent_registry.db`, `memories.db`, `auth.db`.

## Safety discipline

- Escape single quotes when interpolating into SQL: `v="${v//\'/''}"` —
  better, pass data through the server API or tools instead.
- WAL files (`*-shm`, `*-wal`) belong to the live server — never delete
  while the server runs.
- A 0-byte `.db` file breaks schema creation (`ensure_db` skips existing
  files) — delete the empty file and let the tool recreate it.
- Mailbox is append-only JSONL via `tools/mailbox` — never edit lines.

## Anti-patterns

- `jq ... file > file` (truncates the input before reading).
- String-building JSON or SQL from unsanitized variables.
- Editing registry JSON while spawn/wake operations run, without the lock.
