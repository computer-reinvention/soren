# SOREN Quick Start

Get SOREN running in 5 minutes.

## Prerequisites

```bash
# Required
python --version   # 3.11+
node --version     # 18+
tmux -V            # any recent version
git --version      # any recent version

# Install uv if you don't have it
curl -LsSf https://astral.sh/uv/install.sh | sh
```

## Install

```bash
git clone https://github.com/yourusername/soren.git
cd soren
uv sync
cd src/frontend && npm install && npm run build && cd ../..
```

## Run

```bash
./src/orchestrator/soren.sh start
```

## Access

- **Dashboard**: http://localhost:8000
- **tmux session**: `tmux attach -t soren`
- **Health check**: `curl http://localhost:8000/api/webhooks/health`

## Send Your First Task

In the dashboard:

1. Select "supervisor" in the left panel
2. Type: "List all files in the src directory"
3. Click Send

Or via API:

```bash
curl -X POST http://localhost:8000/api/agents/supervisor/message \
  -H "Content-Type: application/json" \
  -d '{"content": "List all files in the src directory"}'
```

## Stop

```bash
./src/orchestrator/soren.sh stop
```

## Key Commands

| Command                             | Description       |
| ----------------------------------- | ----------------- |
| `./src/orchestrator/soren.sh start`  | Start SOREN        |
| `./src/orchestrator/soren.sh stop`   | Stop SOREN         |
| `./src/orchestrator/soren.sh status` | Check status      |
| `./src/orchestrator/soren.sh logs`   | View logs         |
| `tmux attach -t soren`               | Watch agents work |

## What Just Happened?

When you started SOREN, it created:

```
tmux session "soren"
├── monitor     - Health checking daemon
├── supervisor  - Main AI coordinator (Claude)
└── (workers)   - Created on demand for tasks
```

The supervisor can:

- Create workers for simple tasks
- Spawn sessions for complex features
- Modify SOREN itself (safely - auto-rollback on failure)

## Next Steps

- Read the full [User Guide](./USER_GUIDE.md)
- Understand the [Supervisor Role](./SUPERVISOR_ROLE.md)
- Learn about [Self-Improvement](./SELF_IMPROVEMENT_GUIDE.md)

---

_Having issues? Check the [troubleshooting section](./USER_GUIDE.md#troubleshooting) in the User Guide._
