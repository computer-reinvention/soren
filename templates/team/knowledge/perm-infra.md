# Working Knowledge — perm-infra
> Durable memory. Survives context resets. Append via ./tools/knowledge add perm-infra "...". Distill when large.

## Domain Map
- `src/orchestrator/` — `soren.sh` (entry, tmux session mgmt), `monitor.sh` (health polling, recovery, rollback, daemons), `router.sh` (mailbox polling/routing), `compact.sh` (compaction scheduler)
- `tools/` — worker/team/task/mailbox/journal CLIs and `tools/lib/`; bash 3.2-compatible, `set -euo pipefail`, quoted expansions, idempotent re-runs
- `.opencode/hooks/` — verification hooks (pipeline pieces coordinated with perm-devops)
- Hard invariants: never kill/rename the `soren` tmux session or its monitor/supervisor windows; port 8000 is untouchable; `.soren/` is read/append-only; changes to monitor/router/rollback disable the system's ability to recover from bugs — test in a scratch session first

## Patterns
## Pitfalls
## Decisions
