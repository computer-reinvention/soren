# Project conventions

The supervisor and workers read this file for project-specific conventions. Replace with your own — examples below.

## Code style

- Line length: 100
- Default to no comments unless the *why* is non-obvious
- Prefer editing existing files over creating new ones

## Commit style

- Format: `<type>: <description>`
- Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`
- Reference task IDs in the body when applicable

## Testing

- Python: `uv run pytest`
- Frontend: `cd src/frontend && npm run typecheck && npm run build`

## Branching

- Worktree clones operate on `worker/<name>/<task-id>` branches
- Merge clones via fast-forward when their branch is ahead of main

## Definition of done

- Tests pass locally
- Typecheck passes (frontend)
- Health endpoint returns 200
- Journal entry written
