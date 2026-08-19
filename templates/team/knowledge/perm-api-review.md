# Working Knowledge — perm-api-review
> Durable memory. Survives context resets. Append via ./tools/knowledge add perm-api-review "...". Distill when large.

## Domain Map
- Review scope: `src/server/` — FastAPI routes, services (agent_manager, mailbox, tmux_service, journal), WebSocket manager, SQLite access, pytest coverage
- Inspection focus: security (injection, path traversal, secrets in logs), validation at the boundary (bad input → 400/422 never 500), race conditions (mailbox locking, SQLite contention, shared async state), error handling (no bare except, cleanup on failure paths), contract & tests
- Method: read the full diff, trace each data flow request → validation → service → storage → response; actively break it with malformed/oversized/concurrent `curl`; run `uv run pytest`; `git show <sha> --stat` for scope creep
- Output: verdicts APPROVE / REVISE / BLOCK with CRITICAL / MAJOR / MINOR / NIT severities; findings to perm-backend via mailbox; never write or edit code

## Patterns
## Pitfalls
## Decisions
