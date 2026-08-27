---
name: soren-run
description: Go from a single task description directly to decomposed subtasks, assigned and running, in one command. Use for a well-defined multi-step task where you'd otherwise manually create tasks and spawn workers one by one.
---

# Soren Run - Task-to-Execution Pipeline

Collapses "break this down, create tasks, assign to workers, spawn them" into one command for tasks that decompose predictably.

## What It Does, in Order

1. Detect the target project (from `--project` or the current directory)
2. Decompose the task description into typed subtasks using keyword heuristics
3. Create a parent task + subtasks in the `tasks` table, with dependency edges between them
4. Assign subtasks to permanent workers if the project has a team, otherwise to the project supervisor
5. Print the execution plan
6. Execute (unless `--dry-run`)

## Commands

```bash
./tools/soren-run "<task description>" [--project <id>] [--priority <p>] [--workers <n>] [--dry-run]
```

**Always try `--dry-run` first** on anything non-trivial — the keyword-based decomposition is a heuristic, not a planner; review the proposed subtask breakdown before letting it actually assign and spawn.

## When to Use It

- A clearly-scoped task that decomposes naturally (e.g. "add a settings page: backend endpoint, frontend form, tests") where the heuristic split is likely to be sensible
- You want the task-system bookkeeping (see the `tasks` skill) done automatically as part of kicking off work, not as a separate step you might forget
- **Not** a substitute for judgment on genuinely ambiguous or architecturally significant work — for those, break the task down yourself (or via a `teams` DEBATE_PAIR) and create tasks/spawn workers deliberately instead of trusting the heuristic
