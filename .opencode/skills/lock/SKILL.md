---
name: lock
description: Coordinate concurrent file edits between parallel workers using flock-based resource locks. Use before editing a file that another active worker might also touch, especially outside a dedicated worktree.
---

# Lock - Parallel Worker Coordination

Prevents two workers from editing the same file simultaneously. Uses `flock(2)` under the hood (`src/orchestrator/lib/filelock.sh`). Lock files live in `.soren/run/resource-locks/`.

**When you actually need this:** you're working directly in the main checkout (no dedicated worktree — see the `worktree` skill) alongside other active workers, and about to touch a file that isn't obviously yours alone (shared config, a route file multiple team members might edit, a shared doc). If you're in your own worktree, or you're the only one touching a file, you don't need this.

## Commands

```bash
./tools/lock acquire <resource> [timeout]   # blocks until available
./tools/lock release <resource>
./tools/lock run <resource> -- <command>    # holds lock only for <command>, auto-releases
./tools/lock status [resource]              # show active locks
```

## Prefer `run` Over Manual Acquire/Release

```bash
# Preferred — auto-releases even if the command fails or you forget:
./tools/lock run src/server/routes/agents.py -- git add src/server/routes/agents.py

# Manual form — only if you need the lock held across multiple commands
# (e.g. edit, test, then commit):
./tools/lock acquire src/server/routes/agents.py
# ... edit the file, run tests, commit ...
./tools/lock release src/server/routes/agents.py
```

If you use the manual form, **always release it** — a held lock blocks every other worker waiting on that resource until you do (or until you crash, at which point it auto-releases — locks are per-process).

## Notes

- Lock the *resource path*, not an abstract name — use the same string every worker would naturally use for that file so locks actually collide when they should.
- `lock status` before a long edit session is a cheap way to see if someone's already there.
- This is advisory locking between cooperating agents, not filesystem-enforced — it only works if everyone uses it. Don't skip it because "it'll probably be fine."
