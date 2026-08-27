---
name: integration-check
description: Run the layered integration check (import validity, API contract consistency, pytest, TS typecheck, frontend build) across recently changed files. Use after merging multiple workers' changes, or before crediting a batch of work as done.
---

# Integration Check - Cross-Cutting Validation

Individual workers verify their own slice; this catches breakage at the seams once multiple changes land together.

## Checks Run, in Order

1. Import/syntax validity for changed Python files
2. API contract consistency — do frontend `api.ts` calls actually match backend routes?
3. `pytest -x` (fail-fast) — only if Python changed
4. TypeScript typecheck — only if frontend TS/TSX changed
5. Frontend build — only if typecheck passed and frontend changed

Each stage is conditional on what actually changed, so this stays cheap on a small diff.

## Commands

```bash
./tools/integration-check                        # since HEAD~5, human output
./tools/integration-check --since <commit>        # check changes since a specific commit
./tools/integration-check --project <id>          # limit to one project
./tools/integration-check --json                  # machine-readable
```

Exit 0 if everything passes, 1 if anything fails.

## When to Use It

- After several workers on the same feature have each committed independently — their individual tests passed, but did the pieces integrate?
- Before a supervisor marks a multi-worker feature `done` in the task system
- As a broader alternative to running `pytest`/`npm run typecheck`/`npm run build` separately when you're not sure which ones are actually relevant to what changed
