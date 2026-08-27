---
name: soren-init
description: Unified one-command onboarding for a new external project — detects stack, registers it, generates worker context, installs hooks, activates a supervisor, indexes memory. Use when the human wants to bring a new codebase under SOREN management.
---

# Soren Init - Unified Project Onboarding

Replaces doing `projects add` + hook install + context generation + activation + `memory-index` by hand, one step at a time. Runs all of it in the right order for a brand new project.

## What It Does, in Order

1. Validate the path (exists, is a git repo)
2. Auto-detect language, git remote, project name, build/test commands
3. Register the project (`projects add` equivalent)
4. Generate a worker context file with the detected tech stack
5. Install the soren-bridge opencode plugin (unless `--no-hooks`)
6. Activate a project supervisor (unless `--no-activate`)
7. Index the project into semantic memory (unless `--no-index`)
8. Print a summary

## Commands

```bash
./tools/soren-init <path> [--name <name>] [--description <desc>] \
    [--no-hooks] [--no-activate] [--no-index] [--dry-run]
```

`--dry-run` shows what would happen (detected stack, generated names) without actually registering or spawning anything — use this first on an unfamiliar codebase.

## When to Use It

- The human says "bring `<some other repo>` under SOREN" — this is the one-command path instead of the manual `projects`/`teams`/`memory-index` sequence
- If you need finer control over any single step (e.g. skip activation because you want to review the generated context first), use `--no-activate` and follow up with the `projects` skill's `activate` command once you're satisfied
- After this, `teams setup-permanent` (see the `teams` skill) is the usual next step for standing up a permanent team on the newly-registered project
