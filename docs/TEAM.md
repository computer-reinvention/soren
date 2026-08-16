# Team Architecture

> Living document. Updated whenever permanent workers are added, removed, or restructured.
> Last updated: 2026-02-21

## Overview

SOREN runs a **permanent worker team** — long-lived opencode agents that persist across tasks and context resets. Each worker has a fixed identity (name, personality, specialization) and receives work via the supervisor's task system.

The team is designed around the principle that **specialized, adversarial review produces better output than generalist workers**. Builders build, reviewers break — and they're different agents.

## Current Roster

> **EXAMPLE ROSTER — this template ships with no permanent workers.** Bootstrap your own team with `./tools/workers-init-role` or `./tools/teams setup-permanent`, then update this table.

### Builders (3)

| Name | Agent ID | Specialization | Personality | Role File |
|------|----------|---------------|-------------|-----------|
| **Mira** | `perm-frontend` | Frontend / UI — React, TypeScript, Zustand, Tailwind | Meticulous, pixel-perfect, strong aesthetic opinions | `.soren/worker-contexts/perm-frontend-role.md` |
| **Kai** | `perm-backend` | Backend / API — FastAPI, SQLite, WebSocket, Python | Calm, methodical, thinks in data flows and edge cases | `.soren/worker-contexts/perm-backend-role.md` |
| **Sol** | `perm-infra` | Infrastructure — shell scripts, tmux, orchestration, health | Cautious, safety-first, thinks about failure modes first | `.soren/worker-contexts/perm-infra-role.md` |

### Reviewers (2)

| Name | Agent ID | Specialization | Personality | Role File |
|------|----------|---------------|-------------|-----------|
| **Sage** | `perm-ui-review` | Frontend/UI review (adversarial) — visual correctness, a11y, responsive, dark mode | Constructively critical, sharp eye for inconsistency | `.soren/worker-contexts/perm-ui-review-role.md` |
| **Flint** | `perm-api-review` | Backend/API review (adversarial) — security, validation, race conditions, error handling | Sharp, thorough, assumes if it can break it will | `.soren/worker-contexts/perm-api-review-role.md` |

### Support (3)

| Name | Agent ID | Specialization | Personality | Role File |
|------|----------|---------------|-------------|-----------|
| **Nova** | `perm-research` | Research — web search, link following, documentation, synthesis | Relentlessly curious, follows threads to their end | `.soren/worker-contexts/perm-research-role.md` |
| **Bolt** | `perm-devops` | DevOps — CI/CD, automation, git hooks, build pipelines, scripts | Fast, pragmatic, hates manual steps | `.soren/worker-contexts/perm-devops-role.md` |
| **Echo** | `perm-qa` | QA — pytest, typecheck, browser testing, integration testing | Methodical, relentless, finds the scenarios nobody thought of | `.soren/worker-contexts/perm-qa-role.md` |

## Team Topology

```
                    ┌──────────────┐
                    │  Supervisor   │
                    └──────┬───────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
    ┌─────┴─────┐   ┌─────┴─────┐   ┌─────┴─────┐
    │  Builders  │   │ Reviewers  │   │  Support   │
    ├───────────┤   ├───────────┤   ├───────────┤
    │ Mira (FE) │   │ Sage (UI) │   │ Nova (Res) │
    │ Kai  (BE) │   │ Flint(API)│   │ Bolt (Ops) │
    │ Sol  (Inf)│   │           │   │ Echo (QA)  │
    └───────────┘   └───────────┘   └───────────┘
```

## How It Works

### Lifecycle

All permanent workers are spawned with `--permanent` flag:
```bash
./tools/workers spawn perm-frontend "..." --permanent .soren/worker-contexts/perm-frontend-role.md
```

This gives them:
- **Deletion protection** — `workers kill` requires `--force` and logs an audit entry
- **Context reset** — `workers reset <name>` gracefully restarts without losing identity
- **Proactive reset policy (auto-enforced)** — `tools/auto-maintenance` resets IDLE permanent workers after 5 completed tasks or 3 hours since last reset, whichever first (tune with `SOREN_RESET_TASKS`/`SOREN_RESET_HOURS`, 0 disables). Task counts come from `mailbox done` reports; never fires mid-task or while sleeping
- **Cleanup immunity** — `auto-maintenance` and `cleanup_stale` skip permanent workers

### Task Assignment

```bash
# Create a task, then assign it
./tools/tasks add "Fix the login bug" --assign perm-backend

# Or assign an existing task
./tools/workers assign <task-id> perm-backend
```

Workers receive `[TASK]` messages via the mailbox/router pipeline and report back with `[DONE]`, `[STATUS]`, or `[BLOCKED]`.

### Review Workflow

For code changes, the supervisor routes through the adversarial review layer:

1. Builder (Mira/Kai/Sol) implements the change
2. Reviewer (Sage for frontend, Flint for backend) reviews with structured severity ratings
3. Reviewer gives verdict: **APPROVE** / **REVISE** / **BLOCK**
4. If REVISE: builder addresses feedback, reviewer re-reviews
5. QA (Echo) runs test suite and browser verification

UI reviewers and QA use chrome-devtools MCP tools (navigate_page, take_snapshot, take_screenshot, click, fill — available when the chrome-devtools MCP server is enabled in opencode.json) for browser-based visual testing — they navigate to `http://localhost:8000`, take screenshots, test interactions, and verify dark mode / responsive behavior. If the MCP server is unavailable, they verify via curl + build output and note the gap in their [DONE].

### Communication

Workers communicate via the mailbox system:
- **Inbound**: `[TASK]`, `[UPDATE]`, `[QUESTION]`, `[PRIORITY]`, `[COMPLETE]`
- **Outbound**: `[STATUS]`, `[DONE]`, `[BLOCKED]`, `[QUESTION]`

Between tasks, workers idle and respond to heartbeat nudges with `[SYS] Idle — awaiting task.` Ephemeral idle workers auto-sleep after 30 minutes (`SOREN_IDLE_SLEEP_MINUTES`) and are auto-woken when sent a message. Permanent workers are exempt: they are spawned with `keep_awake` set and stay resident between tasks.

## Design Rationale

This team structure emerged from an adversarial debate (see `.soren/journal/2026-02-21/artifacts/04-critic-convergence.md`). Key decisions:

1. **Separate builders and reviewers** — builders should never review their own output. Adversarial review catches what the author misses.
2. **Frontend/backend split in review** — UI review requires visual browser testing (chrome-devtools MCP tools); API review requires tracing data flows and security analysis. Different skills, different tools.
3. **Permanent over ephemeral for core roles** — the cost of context loading (reading AGENTS.md, role files, codebase orientation) on every spawn is significant. Permanent workers amortize this cost across many tasks.
4. **Tester as permanent, not ephemeral** — QA benefits from accumulated knowledge of what breaks and where the gaps are. Echo remembers previous test runs (until context reset).
5. **Research as dedicated role** — following links, synthesizing information, and saving artifacts is a distinct workflow that shouldn't interrupt builders.

## Project Teams

Project supervisors (sup-hero, sup-heroweb, etc.) can create their own permanent workers scoped to their project. These use the same `--permanent` tooling as SOREN permanent workers.

### How It Works

Project supervisors inherit `SOREN_PROJECT_ID` from their environment. When they spawn permanent workers, the `project_id` is set automatically:

```bash
# From a project supervisor's context (SOREN_PROJECT_ID=hero):
./tools/workers spawn hero-frontend "Frontend specialist for Hero" \
  --permanent .soren/worker-contexts/hero-frontend-role.md
```

The worker gets `project_id=hero` in the registry automatically. All permanent worker features work identically: deletion protection, context reset, proactive reset policy, cleanup immunity.

### Listing Project Teams

```bash
./tools/workers team          # All permanent workers (or current project)
./tools/workers team hero     # Only hero project permanent workers
./tools/workers team soren     # Only SOREN permanent workers
```

### Role Files for Project Workers

Project supervisors create role context files in `.soren/worker-contexts/` with a project prefix:
- `.soren/worker-contexts/hero-frontend-role.md`
- `.soren/worker-contexts/heroweb-api-role.md`

Role files follow the same format as SOREN roles (see existing files for examples). Each role file should include the worker's name, personality, specialization, standards, and the "As a Permanent Worker" protocol section.

### Current Project Roster

| Project | Workers | Supervisor |
|---------|---------|------------|
| soren | 8 (see above) | supervisor |
| hero | — | sup-hero |
| heroweb | — | sup-heroweb |

## Ephemeral Workers

Not everything needs a permanent worker. The supervisor still spawns ephemeral workers for:
- One-off tasks outside any permanent worker's domain
- Parallel execution when permanent workers are busy
- Debate pairs for architectural decisions (see `docs/templates/teams/DEBATE_PAIR.md`)

Ephemeral workers use templates from `docs/templates/roles/` and are retired after verification — kept alive through review/verification of their work, then killed once no follow-up remains.

## Modifying This Document

When adding or removing permanent workers:
1. Create/remove the role context file in `.soren/worker-contexts/`
2. Spawn/kill the worker with `--permanent` / `--force`
3. Update the roster table and topology diagram above
4. Run `./tools/workers team` to verify
5. Commit this file with the change
