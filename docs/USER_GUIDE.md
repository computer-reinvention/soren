# SOREN User Guide

Welcome to SOREN - a self-improving multi-agent AI orchestration system. This guide will help you understand what SOREN is, how it works, and how to get started.

## Table of Contents

1. [What is SOREN?](#what-is-soren)
2. [The Vision: Self-Improving AI](#the-vision-self-improving-ai)
3. [Architecture Overview](#architecture-overview)
4. [Getting Started](#getting-started)
5. [Understanding Sessions and Workers](#understanding-sessions-and-workers)
6. [The Safety Model](#the-safety-model)
7. [Using the Dashboard](#using-the-dashboard)
8. [Common Tasks](#common-tasks)

---

## What is SOREN?

SOREN (Claude Multiplexer) is an experimental system that orchestrates multiple Claude AI agents working together. Think of it as a team of AI programmers:

- A **supervisor** receives tasks and decides how to break them down
- **Workers** handle individual pieces of work in isolated environments
- A **health monitor** ensures the system stays operational
- A **dashboard** lets you watch everything in real-time

What makes SOREN special is that **the AI agents can modify SOREN itself**. If you ask SOREN to add a new feature to the dashboard, the agents will write the code, test it, and deploy it - all while you watch.

### Key Features

| Feature                       | Description                                              |
| ----------------------------- | -------------------------------------------------------- |
| **Multi-Agent Orchestration** | Supervisor delegates to multiple workers in parallel     |
| **Real-time Dashboard**       | Watch agents work, see their output, send messages       |
| **Self-Improvement**          | Agents can safely modify the SOREN codebase               |
| **Auto-Recovery**             | If something breaks, the system automatically rolls back |
| **Persistent Memory**         | Journal system preserves context across sessions         |

---

## The Vision: Self-Improving AI

SOREN explores a fascinating question: **What if AI could safely improve its own tools?**

### How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                    The Self-Improvement Cycle               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   1. You request a feature                                  │
│            ↓                                                │
│   2. Supervisor plans the implementation                    │
│            ↓                                                │
│   3. Workers write and test the code                        │
│            ↓                                                │
│   4. Health monitor verifies nothing broke                  │
│            ↓                                                │
│   5. If healthy → Feature is live!                          │
│      If broken → Auto-rollback, try again with lessons      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Why This Matters

Traditional software development has humans writing all the code. SOREN experiments with a different model:

- **Humans provide direction**: "Add a dark mode toggle"
- **AI handles implementation**: Planning, coding, testing
- **System ensures safety**: Automatic rollback if things break
- **AI learns from failures**: Journal preserves context for next attempt

This is still experimental, but it hints at a future where AI can autonomously maintain and improve software systems.

---

## Architecture Overview

SOREN consists of three main layers:

### 1. The Orchestration Layer (tmux + bash scripts)

```
tmux session: "soren"
├── monitor      [Hidden - runs health checks]
├── supervisor   [The main AI coordinator]
├── worker-1     [AI working on task 1]
└── worker-2     [AI working on task 2]
```

Each agent runs in its own tmux window, providing:

- **Isolation**: One agent can't crash another
- **Visibility**: You can attach and watch any agent work
- **Persistence**: Sessions survive disconnections

### 2. The Server Layer (Python + FastAPI)

```
FastAPI Server (port 8000)
├── /api/agents      - Manage AI agents
├── /api/sessions    - Manage session groups
├── /api/messages    - Message history
├── /api/journal     - Persistent memory
├── /api/webhooks    - External integrations
└── /ws              - Real-time updates
```

The server:

- Tracks all agents and their status
- Routes messages between agents
- Broadcasts updates to the dashboard
- Provides the REST API

### 3. The Frontend Layer (React)

```
Dashboard
├── Explorer Panel    - Browse agents and files
├── Chat Panel        - Interact with agents
└── Activity Timeline - Watch events in real-time
```

### How They Connect

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│   [External]     [Mailbox]      [Router]       [Agents]          │
│   Webhooks  ───▶  .soren/    ───▶ daemon  ───▶  tmux windows      │
│   User msgs      mailbox        routes msgs    run Claude        │
│                                                     │            │
│                                                     ▼            │
│                                              [WebSocket]         │
│                                              broadcasts          │
│                                                     │            │
│                                                     ▼            │
│                                              [Dashboard]         │
│                                              React UI            │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Getting Started

### Prerequisites

Before installing SOREN, make sure you have:

- **Python 3.11+** - The server is built with FastAPI
- **Node.js 18+** - The dashboard uses React
- **tmux** - Terminal multiplexing for agent isolation
- **git** - Version control and auto-rollback
- **[uv](https://github.com/astral-sh/uv)** - Fast Python package manager
- **Claude API access** - The agents are powered by Claude

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/yourusername/soren.git
cd soren

# 2. Install Python dependencies
uv sync

# 3. Install frontend dependencies
cd src/frontend
npm install

# 4. Build the frontend
npm run build
cd ../..
```

### Starting SOREN

```bash
# Start the complete system
./src/orchestrator/soren.sh start
```

This command:

1. Creates a tmux session named `soren`
2. Starts the FastAPI server on port 8000
3. Launches the supervisor agent
4. Starts health monitoring and message routing daemons

### Verifying It's Running

```bash
# Check system status
./src/orchestrator/soren.sh status

# View the dashboard
open http://localhost:8000

# Attach to the tmux session
tmux attach -t soren
```

### Stopping SOREN

```bash
./src/orchestrator/soren.sh stop
```

---

## Understanding Sessions and Workers

SOREN organizes work into **sessions** containing **workers**, managed by **supervisors**.

### The Hierarchy

```
Main Session (soren) - Always running, immortal
├── supervisor           - The main coordinator (immortal)
├── worker-quick-fix     - Spawned for simple tasks
└── worker-search        - Spawned for simple tasks

Feature Session (soren-auth) - Created for complex features
├── supervisor-auth      - Feature coordinator
├── worker-jwt           - Works on JWT tokens
└── worker-middleware    - Works on auth middleware
```

### When to Use What

| Situation      | Approach                                      |
| -------------- | --------------------------------------------- |
| Simple fix     | Supervisor creates a worker in main session   |
| Quick search   | Supervisor creates a worker in main session   |
| New feature    | Supervisor spawns a dedicated feature session |
| Major refactor | Supervisor spawns a dedicated feature session |

### Worker Lifecycle

```
1. CREATED    - Worker window created in tmux
2. PENDING    - Task assigned, waiting to start
3. IN_PROGRESS - Actively working
4. TESTING    - Running tests/validation
5. COMPLETE   - Task finished successfully
6. IDLE       - Ready for next task or cleanup
```

### Communication

Agents communicate through:

1. **Mailbox** (`.soren/mailbox`) - Async messages between agents
2. **tmux send-keys** - Direct commands to agent windows
3. **Journal** (`.soren/journal/`) - Persistent context and decisions
4. **WebSocket** - Real-time updates to the dashboard

---

## The Safety Model

The most important aspect of SOREN is its safety model. Since agents can modify the system itself, we need guardrails.

### The Three Lines of Defense

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  Line 1: ISOLATION                                              │
│  ─────────────────                                              │
│  Each agent runs in its own tmux window.                        │
│  If one crashes, others keep running.                           │
│  The supervisor survives all worker failures.                   │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Line 2: HEALTH MONITORING                                      │
│  ─────────────────────────                                      │
│  Health daemon checks /api/webhooks/health every 10 seconds.    │
│  After 3 failures: attempt restart.                             │
│  If restart fails: trigger rollback.                            │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Line 3: AUTO-ROLLBACK                                          │
│  ────────────────────                                           │
│  System tracks last known healthy git commit.                   │
│  On unrecoverable failure:                                      │
│    1. Stash current changes (preserves work)                    │
│    2. Reset to healthy commit                                   │
│    3. Rebuild dependencies                                      │
│    4. Restart server                                            │
│    5. Notify supervisor with error context                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### What Gets Preserved During Rollback

| Preserved                         | Not Preserved                       |
| --------------------------------- | ----------------------------------- |
| tmux sessions (agents stay alive) | Code changes (stashed, recoverable) |
| Journal entries                   | Server state                        |
| Stashed changes                   | Frontend build                      |
| Error context                     | Runtime data                        |

### The Recovery Flow

```
Health Check Fails
        │
        ▼
   (Wait 10 sec)
        │
        ▼
Health Check Fails Again (2/3)
        │
        ▼
   (Wait 10 sec)
        │
        ▼
Health Check Fails (3/3)
        │
        ▼
┌───────────────────┐
│  ATTEMPT RESTART  │
└────────┬──────────┘
         │
    Success? ────Yes────▶ Continue normally
         │
        No
         │
         ▼
┌───────────────────┐
│  JOURNAL FAILURE  │  ◀── Error context saved
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│   STASH CHANGES   │  ◀── Work preserved
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  ROLLBACK TO      │
│  HEALTHY COMMIT   │
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  REBUILD & START  │
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│ NOTIFY SUPERVISOR │  ◀── Agent learns what happened
└───────────────────┘
```

### What This Means for You

- **Experiment freely**: The system recovers from mistakes
- **Work is never lost**: Changes are stashed, not deleted
- **Context survives**: Journal records what was attempted
- **Agents learn**: Error context helps avoid repeat failures

---

## Using the Dashboard

The dashboard at `http://localhost:8000` provides real-time visibility into SOREN.

### The Three Panels

```
┌─────────────┬──────────────────────┬────────────────┐
│             │                      │                │
│  EXPLORER   │      CHAT PANEL      │   ACTIVITY     │
│             │                      │   TIMELINE     │
│  - Agents   │  Talk to agents      │                │
│  - Files    │  See responses       │  Real-time     │
│  - Sessions │  Send commands       │  events        │
│             │                      │                │
└─────────────┴──────────────────────┴────────────────┘
```

### Explorer Panel

- **Agents tab**: See all running agents, their status, and type
- **Files tab**: Browse the codebase
- Click an agent to select it for the chat panel

### Chat Panel

- Send messages to the selected agent
- See agent responses
- View terminal output
- Interrupt agents if needed

### Activity Timeline

- Real-time stream of events
- Tool calls from agents
- Status changes
- Errors and warnings

### Agent Status Colors

| Color     | Status          | Meaning                        |
| --------- | --------------- | ------------------------------ |
| 🟢 Green  | IDLE/COMPLETE   | Ready or finished              |
| 🔵 Blue   | IN_PROGRESS     | Actively working               |
| 🟡 Yellow | PENDING/TESTING | Waiting or validating          |
| 🔴 Red    | FAILED/BLOCKED  | Error or waiting on dependency |

---

## Common Tasks

### Sending a Task to the Supervisor

```bash
# Via the dashboard
1. Select "supervisor" in the Explorer
2. Type your task in the chat panel
3. Click Send

# Via the API
curl -X POST http://localhost:8000/api/agents/supervisor/message \
  -H "Content-Type: application/json" \
  -d '{"content": "Add a logout button to the dashboard header"}'

# Via the mailbox
cat >> .soren/mailbox << 'EOF'
--- MESSAGE ---
timestamp: 2026-01-29T10:00:00Z
from: user
to: supervisor
type: task
id: task-001
---
Add a logout button to the dashboard header
---
EOF
```

### Checking System Health

```bash
# Quick health check
curl http://localhost:8000/api/webhooks/health

# View status log
./src/orchestrator/soren.sh logs

# Or directly
tail -50 .soren/status.log
```

### Viewing Agent Output

```bash
# Via tmux
tmux attach -t soren       # Attach to session
Ctrl+b, n                 # Next window
Ctrl+b, p                 # Previous window
Ctrl+b, w                 # List all windows

# Via API
curl http://localhost:8000/api/agents/worker-1/terminal
```

### Reading the Journal

```bash
# Today's journal
curl http://localhost:8000/api/journal

# Specific date
curl "http://localhost:8000/api/journal?date=2026-01-29"

# Search journals
curl "http://localhost:8000/api/journal/search?q=authentication"

# List dates with journals
curl http://localhost:8000/api/journal/dates
```

### Recovering from Rollback

If the system rolled back your changes:

```bash
# See what was stashed
git stash list

# View the stashed changes
git stash show -p stash@{0}

# Restore the changes (after fixing the issue)
git stash pop
```

### Development Mode

For working on SOREN itself:

```bash
# Backend with auto-reload
uv run uvicorn src.server.main:app --reload --host 0.0.0.0 --port 8000

# Frontend with hot reload (in another terminal)
cd src/frontend
npm run dev

# Run tests
uv run pytest

# Type check frontend
cd src/frontend && npm run typecheck
```

---

## Next Steps

- **Read [SUPERVISOR_ROLE.md](./SUPERVISOR_ROLE.md)** to understand how the main coordinator works
- **Read [SELF_IMPROVEMENT_GUIDE.md](./SELF_IMPROVEMENT_GUIDE.md)** for guidelines on modifying SOREN
- **Explore the codebase** using the dashboard's file browser
- **Experiment!** The safety model means you can try things without fear

---

## Troubleshooting

### Server won't start

```bash
# Check for port conflicts
lsof -i :8000

# View server logs
cat .soren/logs/server.log

# Try manual start
uv run uvicorn src.server.main:app --host 0.0.0.0 --port 8000
```

### Agents not responding

```bash
# Check if tmux session exists
tmux list-sessions

# Check specific agent window
tmux capture-pane -t soren:supervisor -p

# Restart the system
./src/orchestrator/soren.sh restart
```

### Dashboard not loading

```bash
# Rebuild frontend
cd src/frontend
npm run build

# Check server is running
curl http://localhost:8000/api/webhooks/health
```

### Lost work after rollback

```bash
# Your changes were stashed
git stash list

# View what was stashed
git stash show -p

# Restore after fixing the issue
git stash pop
```

---

_SOREN is experimental software. It's designed to be safe for experimentation, but use it with appropriate caution in production environments._
