# SOREN Quick Start

Get SOREN running in 5 minutes.

## Prerequisites

```bash
# Required
python --version   # 3.11+
node --version     # 18+ (npm included)
tmux -V            # any recent version
git --version      # any recent version
curl --version     # any recent version
jq --version       # JSON processing (mailbox + shell tools)
sqlite3 --version  # task database CLI
bun --version      # required to run the .opencode plugin (soren-bridge)

# Install uv if you don't have it
curl -LsSf https://astral.sh/uv/install.sh | sh

# Install opencode if you don't have it
curl -fsSL https://opencode.ai/install | bash   # or: brew install sst/tap/opencode
```

## Install

```bash
git clone https://github.com/computer-reinvention/soren.git
cd soren
./soren.sh setup     # checks prerequisites, installs Python deps (incl. dev), builds frontend
```

<details>
<summary>Manual equivalent</summary>

```bash
uv sync --extra dev
cd src/frontend && npm install && npm run build && cd ../..
```
</details>

## Authenticate (before first start)

Agents need model-provider credentials:

```bash
opencode auth login          # interactive login
# or
export ANTHROPIC_API_KEY=sk-ant-...
```

## Run

```bash
./soren.sh start          # pre-flight checks, then boots the system
```

Other commands: `./soren.sh stop | restart | status | logs | attach | dash | health | doctor | test | smoke`

## Access

- **Dashboard**: http://localhost:8000
- **tmux session**: `tmux attach -t soren`
- **Health check**: `curl http://localhost:8000/api/webhooks/health`

The server binds `127.0.0.1` by default. For remote access, set `SOREN_HOST=0.0.0.0` in `.env` (or use Tailscale/another private network).

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
./soren.sh stop
```

## Key Commands

| Command                             | Description       |
| ----------------------------------- | ----------------- |
| `./soren.sh start`  | Start SOREN (with pre-flight checks) |
| `./soren.sh stop`   | Stop SOREN         |
| `./soren.sh status` | Check status      |
| `./soren.sh logs`   | View logs         |
| `tmux attach -t soren`               | Watch agents work |

## What Just Happened?

When you started SOREN, it created:

```
tmux session "soren"
├── monitor     - Health checking daemon
├── supervisor  - Main AI coordinator (opencode)
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
