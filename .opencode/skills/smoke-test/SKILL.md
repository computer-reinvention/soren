---
name: smoke-test
description: Run smoke tests against every critical live API endpoint, reporting PASS/FAIL with response time. Use after a deploy or restart to confirm the API actually works end-to-end, not just that the process is up.
---

# Smoke Test - Live Endpoint Validation

Goes deeper than the basic `/api/webhooks/health` check — actually exercises critical endpoints (including protected ones) against a running server. Called from `monitor.sh` as part of routine health monitoring; run it yourself after any deploy or restart for immediate confirmation.

## Commands

```bash
./tools/smoke-test                          # against http://localhost:$SOREN_PORT
./tools/smoke-test --url http://localhost:8000
```

## Authentication

Protected endpoints need a token, resolved in this order:
```bash
SOREN_SMOKE_TOKEN=<jwt> ./tools/smoke-test                              # pre-generated JWT
SOREN_SMOKE_USER=<u> SOREN_SMOKE_PASS=<p> ./tools/smoke-test             # auto-login to get one
```
**If neither is set, auth-required tests are skipped and counted as failures** — not silently ignored. A "failing" smoke-test run with no other symptoms often just means no credentials were provided.

Exit 0 if every tested endpoint passes, 1 if any fail.

## When to Use It

- Right after `./soren.sh detached-restart --restart --detach` — confirm the restart actually produced a working API, not just a listening port
- After any backend route change, as a fast sanity check broader than one endpoint's own tests
- If `system-audit`/`system-verify` reports endpoint trouble, this gives more granular per-endpoint pass/fail detail
