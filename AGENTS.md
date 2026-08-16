# AGENTS.md

This file provides guidance to opencode agents working in this repository.

## Project overview

Soren is a self-improving multi-agent AI orchestration system. Once the base system is running, agents can safely add features to the system itself through coordinated work.

The architecture enables safe self-modification through:

- **Isolated execution** — workers run in separate tmux windows, containing blast radius
- **Automatic rollback** — health daemon detects failures and rolls back to the last working git commit
- **Supervisor coordination** — one supervisor delegates tasks and reviews changes before integration
- **Persistent memory** — journal system maintains context across sessions

## Task completion checklist

> **Mandatory**: this checklist must be completed after every task. Skipping steps loses work history.
>
> **Division of labor** (see docs/SUPERVISOR_ROLE.md, which is authoritative): **WORKERS** commit, test, and journal their own work — the supervisor never writes code, commits, or runs tests itself. The **SUPERVISOR's** checklist is to **VERIFY** the worker's output and report to the user.

### Workers — after every code change

- Stage and commit changes with a descriptive message:
  ```bash
  git add <files>
  git commit -m "<type>: <description>"
  ```
- Run tests if Python changed: `uv run pytest`
- Run typecheck if frontend changed: `cd src/frontend && npm run typecheck`
- Build frontend if frontend changed: `cd src/frontend && npm run build`
- Journal the work (see snippet below), then report `[DONE]` with the commit hash

### Supervisor — before marking a task complete

- Confirm the worker's commit exists: `git log -1 --oneline` (or `git show <sha> --stat`)
- Confirm verification passed (verify-done `[VERIFIED]`, test/typecheck output, or reviewer approval)
- Confirm the worker's journal entry exists
- Verify system health: `curl http://localhost:8000/api/webhooks/health`
- Report commit hash and brief summary to the user

### Journaling coordination decisions (supervisors)

Supervisors journal their own coordination decisions — that's allowed; only code edits/commits are delegated:

```bash
curl -X POST http://localhost:8000/api/journal/entry \
  -H "Content-Type: application/json" \
  -d '{
    "title": "<task title>",
    "content": "## What was done\n<description>\n\n## Why\n<rationale>\n\n## Key decisions\n<decisions>\n\n## Issues encountered\n<issues or none>",
    "tags": ["<relevant>", "<tags>"]
  }'
```

## Development commands

### Python backend

```bash
uv sync                                                              # install dependencies
uv sync --extra dev                                                  # with dev dependencies
uv run pytest                                                        # run all tests
uv run pytest tests/test_agents.py -v                                # run a specific test file
uv run uvicorn src.server.main:app --reload --host 0.0.0.0 --port 8000   # dev server
```

### Frontend

```bash
cd src/frontend
npm install                   # install
npm run dev                   # dev server (port 5173, proxies to :8000)
npm run build                 # production build
npm run lint                  # eslint
npm run typecheck             # typescript check
```

### System orchestration

```bash
./soren.sh start    # start the system
./soren.sh stop     # stop everything
./soren.sh status   # status
./soren.sh logs     # view logs
tmux attach -t soren                 # attach to the tmux session
```

## Architecture

### System flow

```
Webhooks/User → Mailbox (.soren/mailbox) → Router daemon → Supervisor agent
                                                              ↓
                                                        Worker agents (tmux)
                                                              ↓
                                                        WebSocket broadcast
                                                              ↓
                                                        React dashboard
```

### Key components

**Backend (`src/server/`):**

- `main.py` — FastAPI app with CORS, static files, route mounting
- `services/agent_manager.py` — agent lifecycle, maps tmux windows to agents
- `services/mailbox.py` — file-based message queue with async locking
- `services/tmux_service.py` — tmux operations (send-keys, capture-pane)
- `services/journal.py` — daily journal persistence
- `websocket/manager.py` — WebSocket connection pool and broadcast

**Frontend (`src/frontend/src/`):**

- `stores/` — Zustand state (agentStore, activityStore, connectionStore, layoutStore)
- `hooks/useWebSocket.ts` — WebSocket with auto-reconnect
- `components/explorer/` — file browser and agent tree
- `components/chat/` — agent interaction panel
- `components/activity/` — event timeline
- `lib/api.ts` — API client

**Orchestration (`src/orchestrator/`):**

- `soren.sh` — main entry point, tmux session management
- `monitor.sh` — orchestrator with health monitoring, recovery, daemon management
- `router.sh` — polls mailbox, routes messages to agents
- `compact.sh` — periodic context compaction scheduler

### Data models

- Agent statuses: `PENDING`, `IN_PROGRESS`, `BLOCKED`, `TESTING`, `COMPLETE`, `FAILED`, `IDLE`
- Message types: `TASK`, `STATUS`, `RESPONSE`, `ERROR`, `USER`
- Agent events (from the soren-bridge opencode plugin): `UserPromptSubmit`, `PostToolUse`, `Stop` — tracked in `routes/agent_events.py`

### Runtime data

`.soren/` directory:

- `mailbox` — message queue
- `status.log` — system status log
- `journal/YYYY-MM-DD/` — daily journals, rollback records, and `artifacts/` (plans, research, debug findings)
- `tasks.db` — task database
- `secrets.db` — encrypted secret store
- `worker-contexts/` — per-worker role files

## API structure

REST endpoints under `/api/`:

- `/agents` — CRUD, messaging, terminal capture
- `/agents/ws` — WebSocket for real-time updates
- `/messages` — history and user message display
- `/agent-events` — agent event receiver (fed by `.opencode/plugins/soren-bridge.ts`)
- `/journal` — daily journal CRUD and search
- `/filesystem` — file browser
- `/webhooks/{source}` — external webhook receiver
- `/webhooks/health` — health check

WebSocket events: `agent_event`, `new_message`, `webhook_received`, `message_sent`

## Testing

Tests use pytest-asyncio with `asyncio_mode = "auto"`. Use `httpx.AsyncClient` with `ASGITransport` for async endpoint tests.

## Environment variables

There are two separate groups (see `.env.example`):

**Python server** (pydantic settings with `SOREN_` prefix, in `src/server/config.py`):

- `SOREN_HOST` / `SOREN_PORT` — server bind (default `127.0.0.1:8000`; set `SOREN_HOST=0.0.0.0` for remote access)
- `SOREN_TMUX_SESSION` — tmux session name (default `soren`)
- `SOREN_MAILBOX_PATH` — message queue path (default `.soren/mailbox`)

**Shell tools** (read separately in `tools/`):

- `SOREN_SESSION` — tmux session name (default `soren`)
- `SOREN_MAILBOX` — message queue path (default `.soren/mailbox`)

## Execution engine (opencode)

Every SOREN agent is an [opencode](https://opencode.ai) TUI running in a tmux
window, pinned to a dedicated embedded-server port (`SOREN_OC_PORT`, range
42000-42999, recorded as `oc_port` in `.soren/agent_registry.json`).

- **Spawning**: `tools/workers spawn` launches `opencode --port <p>` with
  `OPENCODE_PERMISSION` granting full autonomy (replaces Claude Code's
  `--dangerously-skip-permissions`).
- **Events**: `.opencode/plugins/soren-bridge.ts` (active only when
  `SOREN_AGENT=true` AND `SOREN_AGENT_NAME` is set) posts `UserPromptSubmit`/`PostToolUse`/`Stop` to
  `/api/agent-events`, streams thoughts to `/api/thoughts`, appends
  `.soren/audit.log`, touches heartbeat files, enforces the supervisor
  edit block, runs the stop-gate nudge, and triggers
  `.opencode/hooks/verify-done.sh` on mailbox done reports.
- **Messaging**: delivery prefers HTTP (`POST /tui/append-prompt` +
  `/tui/submit-prompt` on the agent's port) with tmux send-keys fallback.
- **Sleep/wake**: session IDs (`ses_*`) captured from plugin events; wake
  resumes with `opencode --session <id>`.
- **Readiness/liveness**: `GET /global/health` on the agent's port.
- **Model tiers**: `haiku|sonnet|opus` map to provider models via
  `tools/lib/opencode.sh` (`SOREN_MODEL_*` env overrides). The default tier
  is opus for all workers (`get_model_default`); `--model` overrides per
  worker. `teams setup` has no model flag — teams always spawn opus.

## Self-improvement safety model

The system protects against breaking itself during self-modification:

1. The monitor daemon polls `/api/webhooks/health` every few seconds.
2. After consecutive failures, it attempts restart.
3. If restart fails, it stashes local changes and rolls back to the previous git commit.
4. It rebuilds dependencies and frontend, then restarts.

This means agents can experiment with changes — if something breaks the system, it auto-recovers to a known-good state. The journal preserves context about what was attempted.
