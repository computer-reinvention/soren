# Investigation: Intermittent Spawn Prompt Delivery Failures

**Task:** t_9tmyaupe
**Date:** 2026-08-18
**Worker:** worker-spawn-delivery

## Summary

Initial task prompts sent during `workers spawn` intermittently fail to land in the worker's opencode TUI. The TUI sits at an empty prompt, but follow-up `workers send` always works.

## Occurrences (5 total)

- worker-commit-hostfix (08-17)
- worker-mailbox-count (08-18)
- reviewer-mailbox-count (08-18)
- worker-daemon-flap (08-18)
- worker-spawn-delivery (08-18, this worker)

Counter-example: worker-mailbox-fix spawned minutes earlier worked fine (intermittent).

## Root Cause

**Race condition between HTTP server readiness and TUI prompt acceptance.**

### The Spawn Flow (before fix)

1. `tmux send-keys` types `opencode --port <p>` + Enter
2. `soren_oc_wait_ready()` polls `GET /global/health` until HTTP 200
3. `soren_oc_http_send()` immediately sends `POST /tui/append-prompt` + `POST /tui/submit-prompt`

### The Race

`/global/health` returns HTTP 200 as soon as the opencode **embedded HTTP server** starts. But the **TUI session/input handler** may not have finished initializing yet. The TUI's prompt-acceptance machinery (session creation, input pipeline wiring) happens asynchronously after the HTTP server binds.

When `soren_oc_http_send` fires:
- `POST /tui/append-prompt` may return HTTP 200 (the route exists and is registered)
- `POST /tui/submit-prompt` either silently drops the prompt (TUI session not ready) or succeeds
- The function returns success (HTTP 200), so the tmux fallback never triggers
- Result: the prompt is lost, the TUI sits at an empty prompt

### Why Intermittent

TUI initialization time varies based on system load, model, session state, and disk I/O. Sometimes it completes before the health endpoint is first polled; sometimes it takes a few hundred ms longer.

### Why `workers send` Always Works

By the time a follow-up `workers send` is executed (seconds to minutes later), the TUI is fully initialized.

## Fix (3 layers of defense)

### Layer 1: TUI Readiness Probe (`soren_oc_wait_tui_ready`)

New function in `tools/lib/opencode.sh` that probes the TUI input pipeline by doing a test `append-prompt` + `clear-prompt` cycle. Called after `soren_oc_wait_ready` in both `cmd_spawn` and `cmd_wake`. This catches the case where health is up but the TUI prompt isn't ready.

### Layer 2: Retry Logic in `soren_oc_http_send`

Changed from single-attempt to retry up to 3 times with escalating backoff (1s, 2s, 3s). Between retries, clears any appended text to avoid duplicates. This handles the case where the TUI becomes ready between retries.

### Layer 3: Post-Send Capture-Pane Verification (spawn only)

After the HTTP send reports success in `cmd_spawn`, waits 3 seconds and inspects the tmux pane via `capture-pane`. If the pane doesn't show activity indicators (thinking, working, tool use, etc.), assumes the prompt was silently dropped and falls back to tmux `send-keys`.

## Files Modified

- `tools/lib/opencode.sh`: Added `soren_oc_wait_tui_ready()`, added retry logic to `soren_oc_http_send()`
- `tools/workers`: Added TUI readiness check after health check in `cmd_spawn`, added post-send verification with tmux fallback in `cmd_spawn`, added TUI readiness check in `cmd_wake`

## Testing

- All 155 pytest tests pass
- Both modified scripts pass `bash -n` syntax validation
- Cannot spawn live test workers in this context (no opencode instances to test against), but the fix is defensive: it adds safety layers that gracefully degrade (if the probe or verification fails, existing behavior continues)
