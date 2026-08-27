# SOREN Self-Improvement Guide

Guidelines for agents that modify SOREN itself. The system is designed to survive your mistakes — but only if you stay inside the safety model described here.

See also: [AGENTS.md](../AGENTS.md) (conventions, checklists) and [SUPERVISOR_ROLE.md](./SUPERVISOR_ROLE.md) (delegation rules).

## The Safety Model

The monitor daemon (`src/orchestrator/monitor.sh`) polls `/api/webhooks/health` every 5 seconds. After 3 consecutive failures (~15s) it runs multi-stage recovery:

1. **Stage 1 — Simple restart.** Stop and restart the server. If health returns, done.
2. **Stage 2 — Targeted revert.** Run root-cause analysis (`tools/root-cause`), then `git revert HEAD --no-edit`, rebuild (uv sync + frontend build), restart, and smoke-test. If the revert doesn't restore health, it is undone.
3. **Stage 3 — Full rollback.** Journal the failure context, back up `.soren/` runtime data, `git stash push` local changes (work is preserved, not deleted), `git reset --hard` to the last healthy commit (`.soren/.last_healthy_commit`, updated on every passing health check), rebuild, restart, and notify the supervisor via mailbox.

Your tmux session and the journal survive rollbacks. Rollback records are written to `.soren/journal/supervisor/YYYY-MM-DD/rollback-*.md`.

## Rules for Self-Modifying Commits

- **Small commits.** One logical change per commit. A targeted revert (Stage 2) only works cleanly if HEAD is a small, self-contained commit.
- **Tested before committed.** Run `uv run pytest` for Python changes; `npm run typecheck && npm run build` for frontend changes. The verify-done hook re-checks this on every `[DONE]`.
- **Journaled.** Record what you changed and why (`./tools/journal log` / `decision`). If the system rolls back, the journal is how the next agent learns what was attempted.
- **Health-checked after.** `curl http://localhost:8000/api/webhooks/health` after any server-affecting change. A passing check updates the healthy-commit marker.

## What You May / May Not Touch

**Safe (low risk):**

- `src/frontend/` — UI changes
- `src/server/routes/` — new endpoints
- `src/server/models/` — data models
- `tests/`, `docs/` — tests and documentation

**Careful (medium risk):**

- `src/server/services/` — business logic
- `src/server/websocket/` — real-time communication

**Structurally protected (enforced by the soren-bridge plugin, not just policy):**

Recovery-critical paths cannot be edited in the live checkout by any agent —
the plugin blocks the tool call:

- `src/orchestrator/` (monitor, router, compact, libs)
- `.opencode/plugins/` and `.opencode/hooks/` (the enforcement layer itself + verification)
- `tools/lib/opencode.sh` (spawn/port/registry primitives)
- `soren.sh` (root entrypoint)

The sanctioned change path: spawn with `--worktree`, edit the worktree copy,
report `[DONE] Commit: <sha>`, and the supervisor merges after review. Workers
spawned with a worktree are additionally jailed: ALL writes to the live
checkout are blocked, not just protected paths. Human operators can bypass
with `SOREN_PROTECTED_OVERRIDE=1`.

**Never:**

- **Never start anything on port 8000.** It is reserved for the SOREN API server; taking it kills all orchestration.
- **Never modify recovery code in the live checkout while the system is running** (see structurally protected paths above — the plugin will refuse anyway).
- **Never force-push.** Rollback targets (`.soren/.last_healthy_commit`) and stashed work depend on history staying intact.
- **Never delete or restructure `.soren/`** — it is runtime state (mailbox, journal, registry, task db). Read freely, append to the journal, don't reorganize.

## Recovery After a Rollback

If the system rolled back your changes:

1. **Read the rollback record**: `.soren/journal/supervisor/YYYY-MM-DD/rollback-*.md` — it contains the error context, git status at failure time, and the commit rolled back to. The supervisor is also notified via mailbox.
2. **Recover your work** — changes were stashed, not deleted:
   ```bash
   git stash list                 # find soren-auto-rollback-<timestamp>
   git stash show -p stash@{0}    # inspect
   git stash pop                  # restore once you understand the failure
   ```
3. **Diagnose before retrying**: `tools/root-cause --error-log <file>` and `.soren/logs/server.log` help identify the breaking change.
4. **Journal the lesson**, then retry with a smaller, tested change.

## Validation Checklist

Before reporting `[DONE]` on a self-modification:

- [ ] Tests pass (`uv run pytest` / `npm run typecheck && npm run build`)
- [ ] Health check passes after the change
- [ ] Change is committed (small, descriptive message) — include the hash in your `[DONE]`
- [ ] Journal entry written
- [ ] Nothing forbidden was touched (port 8000, monitor.sh, soren.sh, health endpoint, `.soren/` structure)

---

_The system recovers from honest mistakes. It does not recover from a broken recovery system — protect monitor.sh above all else._
