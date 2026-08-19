---
name: recovery-ops
description: Human runbook for rollback, rescue branches, recovery, the healthy-HEAD pointer, sentry escalation, circuit breaker, and deep health checks. Use when the system rolled back, work seems lost, the circuit breaker tripped, the supervisor is frozen, or you need to decide between soren.sh restart and stop/start.
---

# Recovery Ops - Rollback, Rescue, and Escalation Runbook

How SOREN recovers itself, and what to do when it can't. Everything below is from `src/orchestrator/monitor.sh` (recovery), `src/orchestrator/soren.sh` (lifecycle), and `.env.example` (tunables).

## How Recovery Works

The monitor dashboard loop checks `/api/webhooks/health` every ~5s. After **3 consecutive failures** (`MAX_FAILURES`, monitor.sh:1338) it runs `attempt_recovery()` (monitor.sh:2218), which first runs root-cause analysis (`tools/root-cause`) and sends a notification, then escalates through stages:

1. **Stage 1 — simple restart.** Stop/start the server. No git mutation.
2. **Circuit breaker check** (before any git stage — see below).
3. **Stage 2 — targeted revert.** `git revert HEAD`, rebuild, restart, verify with `deep_health_check`. Undone if it doesn't fix things.
4. **Stage 3 — full rollback** to the last healthy commit (`rollback_and_restart`, monitor.sh:2041): rescue snapshot → `git reset --hard` → restore runtime data → rebuild deps + frontend → restart.
5. **Stage 4 — progressively older commits** (up to 10 back), same procedure each.

If all stages fail: `ALL STAGES FAILED: Manual intervention required` in the status log, supervisor notified.

## The Healthy-HEAD Pointer

`.soren/.last_healthy_commit` is the rollback target. It only advances after a new HEAD has been running **and passing health checks for `SOREN_HEALTHY_GRACE` (default 300s)** — tracked via `.soren/run/head-first-seen` (monitor.sh:1857). A bad commit that takes minutes to fall over never becomes a rollback target.

Caveat logged by the code itself: if the pointer was set while tracked files were dirty, rolling back to that commit may not reproduce the running state (monitor.sh:1847).

## Rescue Branches — Inspecting and Restoring Lost Work

Before any history-mutating rollback, `create_rescue_snapshot()` (monitor.sh:1931) preserves everything:

- Branch **`soren/pre-rollback-<epoch>`** at the pre-rollback HEAD
- A stash **`soren-auto-rollback-<epoch>`** with tracked **and untracked** dirt (`git stash push -u`)
- A copy of `.soren/` runtime data at `/tmp/soren-rollback-backup-<epoch>` (restored automatically after the reset, minus PID/lock files)

Retention: the newest `SOREN_RESCUE_BRANCH_KEEP` (default 10) rescue branches are kept; older ones are deleted.

```bash
# What rescue snapshots exist?
git for-each-ref --format='%(refname:short) %(committerdate:relative)' refs/heads/soren/pre-rollback-*
git stash list | grep soren-auto-rollback

# What was on a snapshot that isn't on main?
git log --oneline main..soren/pre-rollback-1755600000
git diff main...soren/pre-rollback-1755600000 --stat

# Restore committed work (the code's own suggested path — monitor.sh:2084)
git merge soren/pre-rollback-1755600000        # or cherry-pick specific commits

# Restore uncommitted work
git stash list                                  # find the soren-auto-rollback-<ts> entry
git stash apply stash@{N}
```

If no rescue branch could be created, the reflog is the only recovery path (`git reflog`). Rollback context is also journaled: `.soren/journal/<date>/rollback-*.md`.

## Circuit Breaker

Git-mutating recovery (stages 2–4) is rate-limited to **`SOREN_MAX_GIT_RECOVERIES_PER_HOUR` (default 3)**, tracked in `.soren/run/recovery-events.log` (monitor.sh:1893). When tripped, the log shows `CIRCUIT BREAKER OPEN` and rollbacks are suspended for the hour.

**What it means:** repeated rollbacks did not restore health, so the failure is almost certainly **not in git history** — think bad dependency, disk full, provider outage, env misconfiguration. Do not clear the breaker and retry; investigate:

```bash
./soren.sh doctor                       # prereqs, auth, install state, port drift, system-verify
tail -100 .soren/logs/server.log        # actual server error
df -h; uv sync                          # disk / deps
cat .soren/run/recovery-events.log      # recovery timestamps (epoch)
```

The breaker resets naturally as events age past one hour; deleting `.soren/run/recovery-events.log` force-resets it (only after fixing the real cause).

## Deep Health Check

`deep_health_check()` (monitor.sh:1917) verifies recovery stages: it runs `tools/smoke-test` **only when smoke credentials exist** (`SOREN_SMOKE_TOKEN`/`SOREN_SMOKE_USER`) — without them, auth-gated tests would wrongly fail every stage — otherwise the health endpoint alone decides.

## Sentry — Frozen Supervisor Escalation

Separate from server recovery: when the **supervisor's heartbeat** goes stale, the monitor escalates nudges → task injection → observation → spawning a one-shot **sentry** agent (tmux window `sentry`, lockfile `.soren/.sentry-active`) that recovers/relaunches the supervisor, writes `.soren/worker-contexts/sentry-briefing.md`, then kills itself. A sentry that hangs is force-killed after `SENTRY_TIMEOUT` (300s). Disable escalation entirely with `SOREN_SENTRY=false` (nudges/observation still run).

## Suspend Detection

A laptop that sleeps looks like a dead supervisor (staleness in the thousands). If the gap between two monitor loop iterations exceeds **`SOREN_SUSPEND_GAP` (default 120s)**, the monitor treats it as machine suspend: heartbeat baselines reset, **no escalation** (monitor.sh:643). If you see `Suspend detected` in the status log, nothing is wrong.

## Env Tunables

All optional; defaults in code, documented in `.env.example`:

| Variable | Default | Meaning |
|----------|---------|---------|
| `SOREN_HEALTHY_GRACE` | 300 | seconds a new HEAD must run healthy before becoming the rollback target |
| `SOREN_MAX_GIT_RECOVERIES_PER_HOUR` | 3 | circuit breaker for git-mutating recovery stages |
| `SOREN_RESCUE_BRANCH_KEEP` | 10 | rescue branches to retain |
| `SOREN_SENTRY` | true | false disables sentry escalation |
| `SOREN_SUSPEND_GAP` | 120 | loop-gap seconds treated as machine suspend |

## Restart vs Stop/Start — and the Exit-Trap Quirk

- `./soren.sh restart` = `stop` + `start` — full teardown (kills the tmux session and **every agent in it**) then fresh start. Use when the orchestrator itself is wedged.
- `./soren.sh doctor` first, restart second: most "system frozen" reports are one stuck component, not the whole system.
- Server-only restart without killing agents: `./soren.sh detached-restart --restart --detach` (runs `src/orchestrator/detached-restart.sh` fully detached — this is the **only** safe restart for agents to trigger, since `stop` would kill the tmux session their own shell lives in).

**The exit-trap teardown quirk:** monitor.sh runs `trap cleanup EXIT TERM HUP` (monitor.sh:1469). Cleanup kills the tmux session only on *intentional* shutdown (Ctrl+C twice → `GRACEFUL_SHUTDOWN=true`); on crashes the session and agents are preserved. But if you run `./soren.sh start` from inside the soren tmux session, it **execs monitor.sh in your foreground pane** (orchestrator soren.sh:50-56) — Ctrl+C-twice there tears down the whole session and all agents. Start detached instead: run `./soren.sh start` from **outside** tmux (it creates the session with `tmux new-session -d`) and attach separately with `./soren.sh attach`. If a monitor died uncleanly, the session survives — re-run `soren.sh start` to resume monitoring, don't stop/start.
