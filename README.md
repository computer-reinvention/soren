# Soren

A self-improving swarm of autonomous AI agents that coordinate through message passing to build, test, and improve software — including their own codebase.

Soren is not a single agent with tools. It's a swarm: a supervisor delegates to specialized workers, workers message each other, reviewers audit code, and testers verify results. Each agent is a CLI process in its own tmux window, orchestrated by a shared mailbox, router daemon, and health monitor. The underlying CLI agent is Claude Code by default, but the orchestration layer (mailbox, router, hooks) is agent-agnostic — you could swap in Codex CLI, Gemini CLI, or any other CLI agent.

This repository is a **public template**. Clone it (or use GitHub's "Use this template" button) to spin up your own hub. The code is public; the runtime data your hub generates (mailbox, journal, tasks, secrets) stays local and private to you.

The template is a cleaned version of the original Soren repository which is in personal use. Since all memories and journals of this agent are extremely personal, it is recommended that soren be installed in a private repository.

## Quick start

```bash
git clone <this-repo> my-soren
cd my-soren

# Backend
uv sync                       # install Python deps
cp .env.example .env          # create local env file

# Frontend
cd src/frontend && npm install && npm run build && cd ../..

# Start the system
./src/orchestrator/soren.sh start
tmux attach -t soren          # observe agents working
```

See [docs/QUICKSTART.md](./docs/QUICKSTART.md) for the full walkthrough.

## What's inside

| Document                                                       | Description                                   |
| -------------------------------------------------------------- | --------------------------------------------- |
| **[Quick Start](./docs/QUICKSTART.md)**                        | Get running in a few minutes                  |
| **[User Guide](./docs/USER_GUIDE.md)**                         | Complete guide to using Soren                 |
| **[Concepts](./docs/CONCEPTS.md)**                             | Deep dive into how Soren works                |
| **[Supervisor Role](./docs/SUPERVISOR_ROLE.md)**               | What the supervisor does and how              |
| **[Worker Role](./docs/WORKER_ROLE.md)**                       | How workers operate                           |
| **[Permanent Worker Guide](./docs/PERMANENT_WORKER_GUIDE.md)** | Long-lived workers with domain expertise      |
| **[Team Templates](./docs/TEAM.md)**                           | Pre-built team structures for common patterns |

## Features

- **Multi-agent orchestration** — supervisor delegates tasks to workers running in isolated tmux windows
- **Permanent + clone workers** — long-lived domain experts and ephemeral parallel workers in git worktrees
- **Real-time dashboard** — React UI with WebSocket updates for live monitoring
- **Task system** — SQLite-backed hierarchical tasks with priorities, tags, due dates, dependencies
- **Journal & artifacts** — daily journal for persistent memory across sessions; artifact storage for plans, reports, research
- **Auto-verification hooks** — Claude Code hooks track agent lifecycle and verify work mechanically
- **Worktree isolation** — clone workers operate on separate git worktrees to avoid conflicts
- **Multi-project support** — register external repos with their own supervisors and teams
- **Webhook integration** — receive events from GitHub, etc.
- **File-based mailbox** — async inter-agent communication with attachment support
- **Health monitoring** — automatic restart with git rollback on failures
- **Auto-maintenance** — auto-compaction, stale worker cleanup, watchdog for stuck agents
- **Team templates** — squad, feature team, tiger team, debate pair, and more
- **Authentication** — JWT + bcrypt login for dashboard and API
- **Encrypted secrets store** — `tools/secrets set/get` with on-disk encryption
- **Budget guard** — daily token-cost cap with per-agent tracking
- **Quality metrics** — first-pass success rate, task duration, observability panel
- **Semantic memory** — vector search (fastembed + SQLite) over journals and decisions
- **Pattern extraction** — extract reusable lessons from commits and journal entries
- **Postmortem generator** — PDF reports for failed/reverted commits

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Soren System                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │   Webhook    │───>│   Mailbox    │───>│    Router    │       │
│  │   Endpoint   │    │ (.soren/mail)│    │   (daemon)   │       │
│  └──────────────┘    └──────────────┘    └──────┬───────┘       │
│                                                  │              │
│                                                  ▼              │
│                                         ┌────────────┐          │
│                                         │ Supervisor │          │
│                                         │   Agent    │          │
│                                         └──────┬─────┘          │
│                                                ▼                │
│                                  ┌──────────────────────┐       │
│                                  │   Worker Agents      │       │
│                                  │   (tmux windows)     │       │
│                                  └──────────┬───────────┘       │
│                                             ▼                   │
│  ┌──────────────┐              ┌──────────────────┐             │
│  │ Claude Code  │──────────────│    WebSocket     │             │
│  │    Hooks     │   events     │    Broadcast     │             │
│  └──────────────┘              └────────┬─────────┘             │
│                                         ▼                       │
│                                ┌──────────────────┐             │
│                                │  React Dashboard │             │
│                                └──────────────────┘             │
└─────────────────────────────────────────────────────────────────┘
```

## How it works

### tmux as the runtime

Every agent is a Claude Code CLI session running in its own tmux window inside a shared session called `soren`. The supervisor, workers, and daemons all run as separate windows. Attach with `tmux attach -t soren` and switch between agent windows to observe them working. tmux is the container — agents read/write the filesystem, communicate via the mailbox, and their terminal output is capturable via `tmux capture-pane`.

### Supervisor

The top-level agent. It reads user messages from the mailbox (delivered via the dashboard or webhooks), decides what needs to be done, and delegates to workers. It never writes code directly — it translates requests into worker context files, spawns workers, and reviews results. One supervisor per Soren instance, running in its own tmux window.

### Permanent workers

Named agents with domain expertise that persist across sessions. Each has a role file (`.soren/worker-contexts/*-role.md`) defining their expertise, constraints, and accumulated knowledge. They get spawned once and stay alive, accumulating context. When idle, they wait for the next task.

### Temporary workers

Ephemeral agents spawned for one-off tasks. They receive a task, complete it, report `[DONE]`, and get killed.

### Clone workers

A clone of a permanent worker that runs in a separate git worktree. This lets the same role work on two tasks in parallel without merge conflicts.

### Project supervisors

When Soren manages external projects in separate repos, it creates a project-level supervisor that runs in the project's directory. The project supervisor has its own team and coordinates work within that project. The top-level Soren supervisor delegates to project supervisors rather than managing external projects directly.

### Mailbox + router

Agents communicate by appending JSONL lines to `.soren/mailbox`. The router daemon polls the mailbox, parses each new line, and delivers the message to the target agent's tmux window via `tmux send-keys`. Messages can carry attachments (file paths) for larger payloads.

### Health monitoring

The monitor daemon polls `/api/webhooks/health` every few seconds. After consecutive failures it attempts restart; if restart fails, it stashes local changes and rolls back to the previous git commit, rebuilds, and restarts. This means agents can experiment with changes — if something breaks the system, it auto-recovers to a known-good state. The journal preserves context about what was attempted.

## Storage and memory model

Soren is local-first. All runtime state — mailbox, journal, tasks, worker contexts, secrets — lives in `.soren/` inside your clone of the template. The template (this repo) is public; **your `.soren/` directory is private to you** and never gets pushed to the template's history.

To make your runtime data durable across machines, create a **private** GitHub repo just for it and push `.soren/` there on a schedule (cron, post-commit hook, etc.). Soren reads from that directory regardless of which remote it's tracking, so it doubles as both the storage and the cross-session memory layer.

`.soren/` layout:

- `mailbox` — JSONL message queue
- `journal/YYYY-MM-DD/` — daily journals, plans, research artifacts
- `tasks.db` — SQLite task database
- `secrets.db` — encrypted secret store
- `worker-contexts/` — per-worker role files and conversation state
- `*.log` — daemon and router logs

## Configuration

Copy `.env.example` to `.env` and adjust as needed. Key settings:

- `SOREN_HOST` / `SOREN_PORT` — server bind (default `0.0.0.0:8000`)
- `SOREN_SESSION` — tmux session name (default `soren`)
- `SOREN_MAILBOX` — mailbox path (default `.soren/mailbox`)

The supervisor reads its growth agenda from `.soren/AMBITION.md` and behavioral preferences from `.soren/preferences.json` and `.soren/conventions.md`. Templates for these are in `.soren/` — copy and customize.

## License

This template is yours to clone, modify, and use however you like.
