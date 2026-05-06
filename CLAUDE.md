# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

## Project overview

Soren is a self-improving multi-agent AI orchestration system. Once the base system is running, agents can safely add features to the system itself through coordinated work.

The architecture enables safe self-modification through:

- **Isolated execution** — workers run in separate tmux windows, containing blast radius
- **Automatic rollback** — health daemon detects failures and rolls back to the last working git commit
- **Supervisor coordination** — one supervisor delegates tasks and reviews changes before integration
- **Persistent memory** — journal system maintains context across sessions

## Supervisor task completion checklist

> **Mandatory**: the supervisor agent must complete this checklist after every task. Skipping steps loses work history.

### After every code change

- Stage and commit changes with a descriptive message:
  ```bash
  git add <files>
  git commit -m "<type>: <description>"
  ```
- Create a journal entry via API:
  ```bash
  curl -X POST http://localhost:8000/api/journal/entry \
    -H "Content-Type: application/json" \
    -d '{
      "title": "<task title>",
      "content": "## What was done\n<description>\n\n## Why\n<rationale>\n\n## Key decisions\n<decisions>\n\n## Issues encountered\n<issues or none>",
      "tags": ["<relevant>", "<tags>"]
    }'
  ```

### After complex tasks (when applicable)

- Run tests if Python changed: `uv run pytest`
- Run typecheck if frontend changed: `cd src/frontend && npm run typecheck`
- Build frontend if frontend changed: `cd src/frontend && npm run build`
- Verify system health: `curl http://localhost:8000/api/webhooks/health`

### Before marking a task complete

- Confirm commit exists: `git log -1 --oneline`
- Confirm journal entry was saved
- Report commit hash and brief summary to the user

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
./src/orchestrator/soren.sh start    # start the system
./src/orchestrator/soren.sh stop     # stop everything
./src/orchestrator/soren.sh status   # status
./src/orchestrator/soren.sh logs     # view logs
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
- Agent events (from Claude Code hooks): `PostToolUse`, `Stop` — tracked in `routes/agent_events.py`

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
- `/agent-events` — Claude Code hook event receiver
- `/journal` — daily journal CRUD and search
- `/filesystem` — file browser
- `/webhooks/{source}` — external webhook receiver
- `/webhooks/health` — health check

WebSocket events: `agent_event`, `new_message`, `webhook_received`, `message_sent`

## Testing

Tests use pytest-asyncio with `asyncio_mode = "auto"`. Use `httpx.AsyncClient` with `ASGITransport` for async endpoint tests.

## Environment variables

Key settings (in `src/server/config.py`):

- `SOREN_HOST` / `SOREN_PORT` — server bind (default `0.0.0.0:8000`)
- `SOREN_SESSION` — tmux session name (default `soren`)
- `SOREN_MAILBOX` — message queue path (default `.soren/mailbox`)

## Self-improvement safety model

The system protects against breaking itself during self-modification:

1. The monitor daemon polls `/api/webhooks/health` every few seconds.
2. After consecutive failures, it attempts restart.
3. If restart fails, it stashes local changes and rolls back to the previous git commit.
4. It rebuilds dependencies and frontend, then restarts.

This means agents can experiment with changes — if something breaks the system, it auto-recovers to a known-good state. The journal preserves context about what was attempted.
