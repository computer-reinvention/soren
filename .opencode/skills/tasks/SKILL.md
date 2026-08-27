---
name: tasks
description: Track work as queryable tasks with status, assignment, and dependencies. Use when creating, assigning, updating, or reviewing any piece of in-progress work — this is the system's execution state, not just its memory.
---

# Tasks - Execution State (MANDATORY)

The task system is the **single source of truth for all work in progress**, backed by SQLite (`.soren/soren.db`). Every piece of real work MUST be tracked as a task. This is primarily a **supervisor** responsibility — workers receive assignments and report back via mailbox/`[DONE]`; the supervisor is the one who reflects that into the task system.

**Tasks vs. journal vs. backlog** — these are three different things:
- **Tasks** are execution state: what's in progress right now, who's doing it, what it depends on. Queryable, structured, always current.
- **Journal** is memory: why decisions were made, what was learned. Narrative, not queryable by status. Journaling a task is not the same as tracking it — do both.
- **Backlog** is a proposal queue for ideas that haven't started yet and (for self-generated items) need human approval. `tasks import-backlog` promotes an approved backlog item into a real, trackable task.

## When to Create a Task

- Every user request that involves real work (not a simple question)
- Every delegated worker assignment — use `--assign <agent>`
- Every blocked item — status `blocked`, note the dependency in the description
- Anything you'd be embarrassed to have forgotten about a week from now

## Commands

### Create
```bash
./tools/tasks add "<title>" --project <id> --assign <agent> --priority high --source user --desc "..."
```
Flags: `--project`, `--assign`, `--parent <task-id>` (hierarchy), `--desc`, `--priority` (critical/high/medium/low, default medium), `--source` (user/backlog/self-generated/worker-escalation/system), `--resources <url1,url2>`.

### Read
```bash
./tools/tasks list [--project <id>] [--status <s>] [--assign <agent>] [--priority <p>] [--all]
./tools/tasks tree [--project <id>]     # hierarchical view
./tools/tasks show <id>                 # full detail: assignee, linked workers, status history
./tools/tasks for-project <project-id>  # all tasks + worker assignments for one project
./tools/tasks dashboard                 # counts by status/priority/assignee, attention items
./tools/tasks global                    # full system overview: all projects, supervisors, in-flight work
```

### Update
```bash
./tools/tasks assign <id> <agent>           # -> status assigned
./tools/tasks update <id> in-progress       # you or a worker started
./tools/tasks update <id> review            # worker reported [DONE], verification running
./tools/tasks done <id>                     # shortcut for update <id> done, after verification
./tools/tasks link <id> <worker-name>       # track a worker's involvement without reassigning
```

### Dependencies
```bash
./tools/tasks depends <id> <dep-id>     # id waits for dep-id
./tools/tasks undepends <id> <dep-id>
./tools/tasks ready [--project <id>]    # tasks whose deps are all satisfied
./tools/tasks order [--project <id>]    # topological execution order
```

### Backlog bridge
```bash
./tools/tasks import-backlog            # import all pending (approved) backlog items as tasks
./tools/tasks import-backlog <id>       # import a single item
```

### Cleanup
```bash
./tools/tasks delete <id>               # deletes task + all children
```

## Status Flow

```
pending → assigned → in-progress → review → done
                                  ↘ blocked (resumes to in-progress)
                                  ↘ failed (terminal)
```

## Rules

- **Check `tasks list` at session start** — resume `in-progress` tasks before taking new work
- **Update status in real time** — a worker's `[DONE]` should immediately become `review`, then `done` once verified. No stale tasks.
- **One task per deliverable** — don't lump unrelated work into one task
- **Never lose track by only journaling it** — the task system is queryable, journal entries are not. Journal the *why*, track the *what/status* here.
- **Clean up** tasks older than 48 hours once truly finished

## Example: A Task's Life

```bash
./tools/tasks add "Implement rate limiting" --project soren --priority high --source user
# -> t_a3f8k2m9, status: pending

./tools/tasks assign t_a3f8k2m9 worker-ratelimit
# -> status: assigned; now: ./tools/workers spawn "worker-ratelimit" "..."

./tools/tasks update t_a3f8k2m9 in-progress
# ... worker reports [DONE] via mailbox, Commit: abc123 ...

./tools/tasks update t_a3f8k2m9 review
# ... verify-done.sh runs, comes back [VERIFIED] ...

./tools/tasks done t_a3f8k2m9
```
