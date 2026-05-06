# Ambition

The supervisor reads this file on every heartbeat. When idle, it picks an unchecked goal and spawns workers to investigate or implement it.

Replace this template with your own growth agenda — the priorities you want the system to advance when no human-driven work is queued.

## Format

Each version section lists priorities by tier (P0 → P3) with checkboxes. Mark items complete with `[x]`. Add new versions as the system evolves.

## v1 — bootstrap

### P0 — must work
- [ ] Supervisor can spawn a permanent worker
- [ ] Worker can complete a task and report `[DONE]`
- [ ] Journal entries persist across restarts

### P1 — should work
- [ ] Multi-project registration works end-to-end
- [ ] Quality metrics show real numbers in the dashboard

### P2 — nice to have
- [ ] (your goals here)
