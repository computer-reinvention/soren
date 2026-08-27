---
name: system-verify
description: Validate that SOREN's core infrastructure — hooks, daemons, health endpoint, critical files, tmux session — actually exists and works. Use after any change to orchestration scripts or hooks, or when something feels structurally broken.
---

# System Verify - Infrastructure Existence Check

Narrower than `system-audit` (which checks *health*) — this checks that the pieces the whole system depends on *exist and are wired up correctly* in the first place. Think "is the plumbing there" vs. "is water flowing."

## Commands

```bash
./tools/system-verify
```

No flags — checks hooks, daemons (monitor/router/compact/server), the health endpoint, critical files, and the tmux session. Exits 0 if everything passes, 1 if anything fails.

## When to Use It

- Right after editing `.opencode/hooks/*`, `src/orchestrator/*.sh`, or anything else that's part of the orchestration fabric itself — confirm you didn't break the scaffolding
- The system feels structurally wrong (a daemon seems missing, a hook isn't firing) and you want a definitive existence check before debugging further
- As part of a broader `system-audit` run, which calls this as one of its checks — run this standalone when you specifically suspect infrastructure, not general health

## Note on This Machine

`timeout`/`gtimeout` binaries don't exist on this machine — any timeout-dependent check in this tool (or scripts it calls) should route through `src/orchestrator/lib/common.sh`'s `run_with_timeout()` helper. A check that silently reports "0 failures" forever because its own timeout command failed to even run is exactly the kind of bug this tool exists to catch — verify its own output looks plausible, not just that it exited 0.
