# Working Knowledge — perm-backend
> Durable memory. Survives context resets. Append via ./tools/knowledge add perm-backend "...". Distill when large.

## Domain Map
- `src/server/` — FastAPI app: `main.py` (CORS, static, route mounting), `routes/` (REST under `/api/`: agents, messages, agent_events, journal, filesystem, webhooks), `services/` (agent_manager, mailbox with async file locking, tmux_service, journal), `websocket/manager.py` (broadcast — no side channels)
- `tests/` — pytest-asyncio (`asyncio_mode = "auto"`); endpoint tests via `httpx.AsyncClient` + `ASGITransport`; new endpoints require new tests including error paths
- Storage/config: single consolidated SQLite DB at `.soren/soren.db` (tasks, messages, agent registry, `secrets_vault`, and friends — python access via `get_db` in `src/server/services/db.py`); pydantic settings with `SOREN_` prefix in `src/server/config.py`
- Boundaries: never touch `src/frontend/` (perm-frontend's); publish API contracts in `[DONE]`; reviewed adversarially by perm-api-review

## Patterns
## Pitfalls
## Decisions
