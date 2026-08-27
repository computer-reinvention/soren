---
name: workers-init-role
description: Generate a starter role-context file for a new worker by scanning a target project's tech stack and structure. Use when creating a permanent worker role for a project that doesn't have generated context yet.
---

# Workers Init Role - Generate a Starter Role File

Scans a target directory (tech stack, structure, conventions) and writes a role file to `.soren/worker-contexts/<worker-name>-role.md` — the same kind of generated context `soren-init`/`teams setup-permanent` produce automatically, invokable directly when you need just this piece.

## Commands

```bash
./tools/workers-init-role <worker-name> <role-type> [--project <id>] [--dir <path>]
```

Role types: `frontend`, `backend`, `fullstack`, `qa`, `devops`, `research`, `reviewer`.

## When to Use It

- Standing up a permanent worker for a project outside the normal `teams setup-permanent` flow, where you need a one-off role generated
- Regenerating a role file after confirming via `check-context-freshness` that the existing one is genuinely STALE (don't regenerate a FRESH one — check first)
- **Not** the normal path for spawning an ephemeral worker — those get an inline task description via `workers spawn`, not a generated role file. This is specifically for the durable, project-scanned context permanent workers rely on.
