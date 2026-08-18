---
name: test-strategy
description: Apply the test pyramid, write regression tests first, triage flaky tests, and judge coverage sensibly. Load when writing tests, fixing bugs, or reviewing test suites.
---

# Test Strategy

Tests exist to let you change code without fear. A suite that doesn't catch real regressions — or fails randomly — is worse than fewer, honest tests.

## The Pyramid (and when to break it)

- **Many unit tests**: pure logic, edge cases, error branches. Milliseconds each. This is where "empty input, huge input, unicode, negative numbers" lives.
- **Some integration tests**: routes + services + real SQLite (temp file), `httpx.AsyncClient` with `ASGITransport` in SOREN. These catch the wiring bugs unit tests can't.
- **Few end-to-end tests**: the 3-5 flows that would page a human if broken. Expensive, slow, brittle — spend them wisely.
- Break the pyramid when the risk is in integration (thin CRUD app: favor integration tests; heavy algorithm: favor unit tests). The pyramid is a budget guide, not a law.

## Regression-First (the highest-value habit)

When fixing any bug:

1. Write the test that reproduces the bug. **Watch it fail.** A test you never saw fail proves nothing.
2. Fix the bug.
3. Watch the test pass. Commit test + fix together.

A bug that happened once will happen again after the next refactor — unless its test is standing guard. This is non-negotiable in SOREN: bugfix commits without a regression test should get REVISE in review.

## What to Test (judgment, not ritual)

- Test **behavior at the boundary**, not implementation: "POST /api/tasks with no title returns 422", not "handler calls validate_title()". Implementation-coupled tests break on every refactor while catching nothing.
- Priority order: error paths and edge cases (where bugs live) > happy path (usually obviously working) > getters/config/framework glue (rarely worth it).
- Every test asserts something specific. `assert response is not None` is a smoke test cosplaying as coverage.
- One logical assertion-cluster per test; name it after the behavior: `test_expired_token_rejected_with_401`.

## Flaky Test Triage

A flaky test destroys trust in the whole suite. Never `@skip` and walk away — triage:

1. **Timing**: `sleep(0.5)` and hoping → replace with polling/waiting on the actual condition (with timeout).
2. **Ordering**: test passes alone, fails in suite → shared state leaking (module globals, un-reset DB, env vars). Isolate via fixtures.
3. **External dependence**: real network, real clock, real ports → fake/inject them (freeze time, use port 0, mock HTTP).
4. **Genuine race in the product** — the flake is a real bug report. Investigate the code, not the test.

Rule: a flake gets fixed, quarantined-with-a-ticket, or deleted within a day. Rerunning until green is data destruction.

## Coverage Judgment

- Coverage tells you what is definitely *untested*; it never tells you what is well-tested. 100% coverage with weak assertions is a lie detector that always says "truth".
- Use coverage diffs to find untested *new* code, not to chase a global number.
- 80% with strong assertions on error paths beats 95% of happy-path snapshots.

## Checklist

1. Bug fix? Regression test written first and seen failing.
2. New endpoint? Happy path + at least one 4xx path tested.
3. Tests pass in any order and in parallel (no shared mutable state).
4. No unconditional sleeps; all waits are condition-based with timeouts.
5. `uv run pytest` (or project equivalent) run and green *before* reporting `[DONE]` — evidence in the report.

## Anti-Patterns

- Asserting on log strings or private attributes.
- Snapshot tests as the only tests — they assert "something changed", not "something broke".
- Mocking the thing under test (a test of the mocks).
- Deleting a failing test to "fix CI".
