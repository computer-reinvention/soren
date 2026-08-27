---
name: verifications
description: Inspect verification history, pending retry counters, and escalation latches, and clear a stuck latch. Use to check why a worker's [DONE] hasn't been verified yet, or to unblock a worker latched after exhausting its retry budget.
---

# Verifications CLI - Inspect & Clear Verification State

The read/manage interface into the verify-done pipeline's state (see the `verification` skill for the full DONE → verify-done.sh → FIX-REQUEST/VERIFY-FAILED protocol this tool surfaces state for).

## Commands

```bash
./tools/verifications recent [N]                 # last N verification events (default 20): time, agent, outcome, detail
./tools/verifications pending                     # agents with an active retry counter (unresolved FIX-REQUESTs)
./tools/verifications latches                     # escalation latches: agent, task key, age
./tools/verifications clear-latch <agent> [key]   # supervisor unblock path
```

Everything is read-only except `clear-latch`.

## Env

- `SOREN_HOME` — soren root
- `SOREN_DB` — consolidated-DB path override (the same sandboxing override `verify-done.sh` itself honors — useful for testing against an isolated DB)

## When to Use It

- A worker's `[DONE]` seems to have gone nowhere — `verifications recent` shows what actually happened to it
- Deciding whether to re-dispatch a worker or wait — `verifications pending` shows who's mid-retry
- A worker reports it's stuck with no response to further `[DONE]`s — check `verifications latches`; if it's latched, either `clear-latch` explicitly or re-dispatch with `workers send` (which auto-clears all of that agent's latches as a side effect)
- Don't clear a latch reflexively — read what escalated first (`verifications recent` around that time) so you're not just resetting the counter on a genuinely broken task
