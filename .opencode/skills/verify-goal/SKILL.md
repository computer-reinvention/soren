---
name: verify-goal
description: Verify that AMBITION.md self-improvement goals are actually working in production, not just marked complete. Use before crediting a goal as done, or periodically to catch goals that silently regressed.
---

# Verify Goal - AMBITION.md Reality Check

A goal marked "done" in `.soren/AMBITION.md` isn't necessarily still true — code drifts, dependencies change, a later commit can silently break something an earlier goal implemented. This checks the *current, live* system against each goal's claim.

## Commands

```bash
./tools/verify-goal                    # check all goals
./tools/verify-goal --version <N>      # only goals from a specific AMBITION.md version
./tools/verify-goal --json             # machine-readable
./tools/verify-goal --save             # save JSON to journal artifacts
```

## Exit Codes

- `0` — all goals verified
- `1` — at least one goal is stale (was working, no longer is)
- `2` — only unverifiable goals found (nothing definitively broken, but nothing confirmed working either)

## When to Use It

- Before crediting a self-improvement goal as genuinely complete, not just committed
- Periodically (e.g. as part of a maintenance sweep) to catch goals that quietly regressed since they were last checked — the whole point of self-improvement is that later changes shouldn't silently undo earlier ones
- If a `--version N` goal set feels suspect after a big refactor, scope the check to just that version rather than re-verifying everything
