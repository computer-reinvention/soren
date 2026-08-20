# SOREN Core Concepts

This document explains the fundamental concepts behind SOREN for users who want to understand the system deeply.

## Table of Contents

1. [The Problem SOREN Solves](#the-problem-soren-solves)
2. [Multi-Agent Coordination](#multi-agent-coordination)
3. [Sessions vs Workers](#sessions-vs-workers)
4. [The Mailbox System](#the-mailbox-system)
5. [The Journal System](#the-journal-system)
6. [State Storage](#state-storage)
7. [Safe Self-Improvement](#safe-self-improvement)
8. [The Immortal Supervisor Pattern](#the-immortal-supervisor-pattern)

---

## The Problem SOREN Solves

### Single-Agent Limitations

A single AI agent has constraints:
- **Context window limits**: Can't hold an entire codebase in memory
- **No parallelism**: Works on one thing at a time
- **No persistence**: Loses context between sessions
- **No isolation**: A bad command can break everything

### The Multi-Agent Solution

SOREN addresses these by distributing work:

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   SINGLE AGENT                    MULTI-AGENT (SOREN)            │
│   ────────────                    ──────────────────            │
│                                                                 │
│   One context window              Multiple independent agents   │
│   Sequential work                 Parallel execution            │
│   Volatile memory                 Persistent journal            │
│   Single point of failure         Isolated failure domains      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Multi-Agent Coordination

### The Supervisor-Worker Model

SOREN uses a hierarchical coordination model inspired by human organizations:

```
                    ┌─────────────┐
                    │ SUPERVISOR  │
                    │  (plans)    │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ WORKER 1 │ │ WORKER 2 │ │ WORKER 3 │
        │ (executes)│ │ (executes)│ │ (executes)│
        └──────────┘ └──────────┘ └──────────┘
```

### Responsibilities

**Supervisor**:
- Receives incoming tasks
- Breaks complex tasks into subtasks
- Decides whether to use workers or spawn sessions
- Monitors progress
- Integrates results
- Maintains system-wide context via journal

**Workers**:
- Execute focused, specific tasks
- Report completion or blockers
- Have limited context (just their task)
- Are ephemeral (created and destroyed as needed)

### Communication Patterns

```
TASK ASSIGNMENT:
  Supervisor ──(tmux send-keys)──▶ Worker

PROGRESS UPDATES:
  Worker ──(mailbox message)──▶ Supervisor

COMPLETION NOTIFICATION:
  Worker ──(./tools/mailbox done "[summary + commit hash]")──▶ Supervisor
  (machine-verified by the verify-done hook: commit exists, tests pass;
   no-code tasks report "no-op: <summary>" instead — no commit expected)

REAL-TIME VISIBILITY:
  All agents ──(WebSocket)──▶ Dashboard
```

---

## Sessions vs Workers

This is a key architectural decision in SOREN.

### Workers (In-Session)

Workers are created **within** an existing tmux session:

```bash
# Creates a new window in the "soren" session
tmux new-window -t soren -n "worker-fix-typo"
```

**Use for**:
- Simple, focused tasks
- Quick fixes
- Searches and investigations
- Anything one agent can complete alone

**Example**: "Fix the typo on line 42 of config.py"

### Sessions (Dedicated)

Sessions are **separate tmux sessions** with their own supervisors:

```bash
# Creates an entirely new session
tmux new-session -d -s soren-auth
```

**Use for**:
- Complex features requiring coordination
- Multiple interdependent tasks
- Long-running projects
- Work that benefits from dedicated management

**Example**: "Implement user authentication with JWT"

### The Decision Flow

```
                     ┌──────────────┐
                     │ New Task     │
                     └──────┬───────┘
                            │
                            ▼
                  ┌─────────────────────┐
                  │ Is this complex?    │
                  │ Multiple components?│
                  │ Needs coordination? │
                  └─────────┬───────────┘
                            │
               ┌────────────┴────────────┐
               │                         │
              Yes                       No
               │                         │
               ▼                         ▼
       ┌───────────────┐        ┌───────────────┐
       │ SPAWN SESSION │        │ CREATE WORKER │
       │ + supervisor  │        │ (in session)  │
       └───────────────┘        └───────────────┘
```

---

## The Mailbox System

The mailbox is SOREN's asynchronous message passing system.

### How It Works

Agents **always** send messages through the `./tools/mailbox` CLI — never by appending to the file by hand. The router only parses the JSONL lines that `./tools/mailbox` writes; anything else is silently ignored.

```bash
./tools/mailbox send <to> "<subject>" ["body"]   # message another agent
./tools/mailbox done "summary + commit hash"      # report completion
./tools/mailbox blocked "issue"                   # report a blocker
```

For reference, each line in `.soren/mailbox` is a single JSON object:

```json
{"id":"<uuid>","ts":"2026-01-29T10:00:00Z","from":"soren:worker-auth","to":"soren:supervisor","subject":"[DONE] Authentication module complete","body":"Files changed: auth.py, middleware.py\nTests: 12 passing\nCommit: a1b2c3d","status":"submitted"}
```

### Message Flow

```
1. Agent writes a JSONL line via ./tools/mailbox
        │
        ▼
2. Router daemon (router.sh) polls the mailbox
        │
        ▼
3. Router parses each new JSONL line, extracts routing info
        │
        ▼
4. Router sends to appropriate recipient via tmux send-keys
        │
        ▼
5. Router broadcasts to WebSocket for dashboard
```

### Message Types

| Type | Purpose | Example |
|------|---------|---------|
| `TASK` | Assign work | "Implement login endpoint" |
| `STATUS` | Progress update | "50% complete, found issue with X" |
| `RESPONSE` | Task completion | "Done. See files X, Y, Z" |
| `ERROR` | Problem report | "Failed: dependency not found" |
| `USER` | Human message | "Please prioritize feature X" |

### Why a File-Based Mailbox?

1. **Simplicity**: No database or message broker needed
2. **Visibility**: Anyone can `cat .soren/mailbox` to see messages
3. **Persistence**: Messages survive restarts
4. **Debugging**: Easy to inspect and manipulate
5. **Git-friendly**: Can be tracked or ignored as needed

---

## The Journal System

The journal is SOREN's persistent memory across sessions and context compactions.

### Structure

```
.soren/journal/
├── 2026-01-28/
│   ├── journal.md           # Main journal entries
│   ├── rollback-143022.md   # Auto-generated on rollback
│   └── artifacts/           # Diagrams, generated files
└── 2026-01-29/
    ├── journal.md
    └── artifacts/
```

### What Goes in the Journal

**DO journal**:
- Task assignments and why they were delegated that way
- Architectural decisions and rationale
- Session/worker creation decisions
- Important discoveries or insights
- Error resolutions
- Integration milestones

**DON'T journal**:
- Routine status checks
- Every tool call (hooks capture these)
- Transient debugging info

### Why the Journal Matters

When agents have their context compacted (to fit in the context window), they lose detailed memory. The journal preserves:

```
Before Compaction:
┌─────────────────────────────────────────┐
│ Full conversation history               │
│ Every tool call and result              │
│ All intermediate reasoning              │
└─────────────────────────────────────────┘

After Compaction:
┌─────────────────────────────────────────┐
│ Summarized context                      │
│ + Access to journal for details         │
└─────────────────────────────────────────┘
```

### Using the Journal API

```bash
# Add an entry
curl -X POST http://localhost:8000/api/journal/entry \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Authentication Feature Complete",
    "content": "Implemented JWT auth.\n\nDecision: Used RS256 for tokens because..."
  }'

# Read today's journal
curl http://localhost:8000/api/journal

# Search across all journals
curl "http://localhost:8000/api/journal/search?q=authentication"
```

---

## State Storage

All structured runtime state lives in **one SQLite database**:
`.soren/soren.db` (WAL mode — the `-wal`/`-shm` sidecars next to it are
normal). Access it via `soren_db` from `tools/lib/db.sh` in shell (adds the
project-wide 5s busy timeout; plain `sqlite3 .soren/soren.db` is fine
interactively) and `get_db` in `src/server/services/db.py` from Python. The
`SOREN_DB` env var overrides the path (the sandboxing mechanism for tests).

### Tables

| Domain | Tables |
|--------|--------|
| Tasks | `tasks`, `task_dependencies`, `task_status_history` |
| Conversations & events | `messages`, `agent_events`, `thoughts` |
| Agent registry | `agents` (master), `agent_archives`, `heartbeat_history` |
| Auth & secrets | `users`, `secrets_vault` (encrypted vault, via `tools/secrets`) |
| Memory | `memories` (semantic vector store) |
| Verification | `fix_retries` (retry counters + escalation latches), `verify_events` |
| Runtime bookkeeping | `spawn_events`, `compact_timestamps`, `failure_log` |
| Registries & settings | `projects`, `teams`, `schedule`, `prefs` |

### Regenerated JSON views

`agent_registry.json`, `projects.json`, and `teams.json` in `.soren/` are
**read-only views** regenerated from the corresponding `soren.db` tables so
existing jq readers keep working. Never write them directly — mutations go
through the tools (`tools/workers`, `tools/projects`, `tools/teams`,
`soren_registry_update` in `tools/lib/opencode.sh`), which update the table
and regenerate the view atomically.

### What stays as files, and why

- `mailbox` (+ `mailbox-archive`) — append-only JSONL; visible with `cat`,
  robust while the server is down, and the router tails it as a file.
- `journal/YYYY-MM-DD/` — markdown meant for humans and agents to read and
  grep; also the rollback record.
- `worker-contexts/` — per-worker role files injected at spawn; agents read
  them as plain files.
- `templates/team/knowledge/*.md` — hand-curated, git-versioned role
  knowledge (repo-tracked, unlike everything above).
- Recovery scalars (`.last_healthy_commit`, heartbeat timestamp files, log
  markers) — the recovery path must be able to read them even when SQLite
  or the DB itself is what broke.

### Migration and legacy names

The five legacy per-domain DBs (`tasks.db`, `conversations.db`,
`agent_registry.db`, `auth.db`, `memories.db`) were consolidated by
`tools/migrate-state` (runbook: stop the system, run it, check
`migrate-state status`); the old files are preserved under
`.soren/backup-pre-consolidation/<timestamp>/`. Legacy JSON/state files
(`preferences.json`, `prefs.json`, `schedule.json`, the `.fix-retries/`
dir, `.compact-timestamps`) are imported lazily on first touch and renamed
`*.migrated`. `./soren.sh doctor` warns when un-migrated legacy DBs are
still present.

---

## Safe Self-Improvement

SOREN is designed to safely modify itself. Here's how.

### The Problem

Traditional systems can't safely modify themselves because:
- A bug in new code can crash the system
- No automatic recovery mechanism
- Lost context about what was attempted

### SOREN's Solution

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                    HEALTH MONITORING LOOP                       │
│                                                                 │
│   ┌──────────────┐         ┌──────────────┐                     │
│   │ Check health │◀────────│   healthy    │                     │
│   │ every 5 sec  │         │              │                     │
│   └──────┬───────┘         └──────────────┘                     │
│          │                        ▲                             │
│          │                        │                             │
│      unhealthy                    │                             │
│          │                    recovered                         │
│          ▼                        │                             │
│   ┌──────────────┐         ┌──────────────┐                     │
│   │ Count failure│────────▶│   Recover    │                     │
│   │ (1, 2, 3)    │  3x     │  (rollback)  │                     │
│   └──────────────┘         └──────────────┘                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### The Recovery Sequence

1. **Detection**: Health check fails 3 times consecutively (≈15 seconds at the 5s cycle)
2. **Simple Recovery**: Try restarting the server
3. **Journaling**: If restart fails, record error context
4. **Stashing**: Stash local changes (preserves work)
5. **Rollback**: Reset to last known healthy commit
6. **Rebuild**: Reinstall dependencies, rebuild frontend
7. **Restart**: Start the server fresh
8. **Notification**: Tell supervisor what happened

### What Gets Tracked

```
.soren/.last_healthy_commit
│
│  Contains: abc123def456...
│
│  Updated: Every time health check passes
│  Used: As rollback target when recovery needed
```

### Safe Modification Zones

```
SAFE (low risk):
├── src/frontend/          # UI changes
├── src/server/routes/     # New endpoints
├── src/server/models/     # Data models
├── tests/                 # Test files
└── docs/                  # Documentation

CAREFUL (medium risk):
├── src/server/services/   # Business logic
└── src/server/websocket/  # Real-time communication

FORBIDDEN (high risk):
├── src/orchestrator/monitor.sh  # Recovery system + master orchestrator
├── src/orchestrator/soren.sh     # System startup
└── /api/webhooks/health endpoint # Health check
```

### The Autonomy Dial

`SOREN_AUTONOMY` controls how much agent-invented work happens without a human
(see `.env.example`):

- **`supervised` (default)** — agent-added backlog items (`SOREN_AGENT=true`) are
  recorded as unapproved proposals (`source='self'`, `approved=0`). They cannot be
  claimed until a human runs `./tools/backlog approve <id>` (or `approve --all`);
  agents can never approve or reject items. Discoveries — reviewer bonus findings,
  self-improvement ideas — get *proposed*, not acted on, and no workers are spawned
  for self-invented tasks.
- **`autonomous`** — the prior ungated behavior: agents may claim any backlog item,
  including their own proposals, and act on findings proactively.

This keeps self-improvement available while ensuring a human stays in the loop for
work the system invents for itself.

---

## The Immortal Supervisor Pattern

The main supervisor has special properties that make it resilient.

### Immortality

The main supervisor:
- Cannot be killed by workers
- Survives rollbacks
- Survives restarts
- Has persistent context via journal

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   NORMAL OPERATION              AFTER ROLLBACK                  │
│                                                                 │
│   soren session                  soren session                    │
│   ├── monitor                   ├── monitor (restarted)         │
│   ├── supervisor ◀── ALIVE     ├── supervisor ◀── STILL ALIVE │
│   └── worker-1                  └── (workers may be gone)       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Why This Matters

1. **Continuity**: The supervisor maintains context through failures
2. **Learning**: Error notifications help it avoid repeating mistakes
3. **Coordination**: Workers can fail, but coordination survives
4. **Recovery**: Supervisor can spawn new workers to retry failed work

### The Notification Flow

After a rollback:

```
Health daemon
      │
      │ "System rolled back due to..."
      ▼
  Mailbox
      │
      │ Routed to supervisor
      ▼
  Supervisor
      │
      │ 1. Reads error context
      │ 2. Checks journal for what was attempted
      │ 3. Decides on next action
      │    - Retry with different approach?
      │    - Escalate to user?
      │    - Log and wait?
```

---

## Summary

SOREN is built on these core concepts:

| Concept | Purpose |
|---------|---------|
| **Multi-Agent** | Distribute work, parallelize, isolate failures |
| **Supervisor-Worker** | Coordinate complex tasks hierarchically |
| **Sessions** | Group related work, provide dedicated management |
| **Mailbox** | Async communication between agents |
| **Journal** | Persistent memory across sessions |
| **Health Monitor** | Detect and recover from failures |
| **Auto-Rollback** | Safe self-modification with automatic recovery |
| **Immortal Supervisor** | Resilient coordination that survives failures |

Together, these enable an AI system that can safely experiment with improving itself.

---

*For practical usage, see the [User Guide](./USER_GUIDE.md). For modification guidelines, see [Self-Improvement Guide](./SELF_IMPROVEMENT_GUIDE.md).*
