---
name: verification
description: Use when reporting task completion ([DONE]), handling [FIX-REQUEST] or [VERIFY-FAILED], checking verification status, or clearing escalation latches. Covers the verify-done pipeline, no-op protocol, commit-hash requirements, retry budget, and tools/verifications CLI.
---

# Verification Protocol

Every worker `[DONE]` is machine-verified by
`.opencode/hooks/verify-done.sh` (triggered when the soren-bridge plugin sees
`./tools/mailbox done`). It runs in the background: extracts the commit hash,
verifies the commit exists (searching registered projects), runs pytest if
`.py` files changed and typecheck if `src/frontend/` changed, then reports.

## Reporting [DONE] correctly

**Code changed** — the `Commit:` line is mandatory:

```bash
./tools/mailbox done "[DONE] <summary>
Tested: <what you ran and its result>
Commit: <sha>"
```

verify-done requires a 7-40 char hex hash in every non-research `[DONE]`.
Use the hash of **your** commit — never HEAD's hash for work you didn't do.

**No code changed** (output-only tasks, verification echoes, config checks,
read-only investigations) — use the canonical no-op marker:

```bash
./tools/mailbox done "no-op: <one-line summary of what you verified/produced>"
```

Rules (reviewers are required to reject violations):

- **NEVER create an empty commit** (`git commit --allow-empty`) "for
  traceability" — it litters history and gets REJECTED.
- **NEVER claim `no-op:` when files actually changed** — a false no-op is a
  false completion report.
- Don't leave the hash off without the marker — that triggers `[FIX-REQUEST]`
  retries.
- If you cannot verify your work, report `[BLOCKED]` instead of `[DONE]`.

**Exemptions** from the commit requirement:

- Agents whose name contains `research` reporting findings
  (answer/findings/analysis keywords) — `[VERIFIED]` immediately.
- Agents whose compiled contract (`.soren/run/contracts.json`, from
  `tools/contract compile`) sets `done_requires_commit: false`.

## The pipeline and outcomes

```
[DONE] → verify-done.sh → commit exists? tests pass?
   ├─ yes → [VERIFIED] to supervisor (retry counter + latch cleared, lesson logged)
   └─ no  → [FIX-REQUEST] back to the worker (attempt N/2)
             └─ budget exhausted → [VERIFY-FAILED] to supervisor + escalation latch
```

- **Retry budget**: 2 fix attempts per **task key** (the commit hash, or an
  md5 of the DONE summary when no hash) — one flaky task can't burn another
  task's budget. Counters live in the `fix_retries` table of `.soren/soren.db`
  (a legacy `.soren/.fix-retries/` count-file dir is imported once, then
  renamed `*.migrated`).
- **Escalation latch**: after escalation, the row's `escalated` flag is set
  in `fix_retries` and the counter resets. While latched, further `[DONE]`
  reports for that task key produce only a status.log line — no auto
  FIX-REQUEST. The worker is stuck until a supervisor intervenes.
- **Two clearing paths**:
  1. `./tools/verifications clear-latch <agent> [key]` — explicit supervisor
     unblock.
  2. `./tools/workers send <agent> ...` — a new dispatch auto-clears all of
     the agent's latches (workers effectively receive auto-clears when
     re-tasked).
- Results are also POSTed to `/api/messages/verify-result`, recorded in the
  `verify_events` table (what `tools/verifications recent` reads), and every
  event is logged to `.soren/status.log` as `ts | [VERIFY] | agent | detail`.

## Handling [FIX-REQUEST] (as a worker)

You get `[FIX-REQUEST] <type>: attempt N/2` with instructions. Fix the actual
problem (commit missing files, correct the hash, fix failing tests), commit,
and report `[DONE]` again with the corrected `Commit:` line. Don't paper over
it — after attempt 2/2 the next failure escalates to your supervisor.

## Handling [VERIFY-FAILED] (as a supervisor)

The worker exhausted its budget and is latched. Inspect, decide, then unblock
via one of the two clearing paths above (or re-dispatch, which auto-clears).

## Reviewer verdicts

Review-role agents report `[DONE] verdict: APPROVE | REVISE | BLOCK` with
`Commit: <reviewed sha>` (the hash of the commit they reviewed — never an
invented one; commit-less reviews use `no-op:`). REVISE means the builder
addresses findings and gets re-reviewed. Reviewers police the no-op protocol:
empty commits and false no-op claims are REVISE/BLOCK material.

## CLI reference — tools/verifications

```bash
./tools/verifications recent [N]              # last N verification events
                                              # (default 20): time, agent,
                                              # outcome, detail
./tools/verifications pending                 # agents with active retry
                                              # counters (unresolved FIX-REQUESTs)
./tools/verifications latches                 # escalation latches: agent,
                                              # task key, age
./tools/verifications clear-latch <agent> [key]  # supervisor unblock path
```

Read-only except `clear-latch`. Env: `SOREN_HOME` (soren root), `SOREN_DB`
(consolidated-DB path override — the same sandboxing override
verify-done.sh honors).

## Lifecycle context

Worker lifecycle: spawn → work → `[DONE]` (with `Commit: <sha>` OR `no-op:`)
→ verification (`[VERIFIED]` or `[FIX-REQUEST]`) → follow-ups or retirement.
Stay alive and responsive after `[VERIFIED]` — supervisors clean up only after
verification, never immediately after `[DONE]`.
