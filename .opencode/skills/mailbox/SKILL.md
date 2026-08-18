---
name: mailbox
description: Send messages to other agents or the user. Use when you need to communicate with supervisor, other workers, or report to user.
---

# Mailbox Communication

## You Are An Agent

You are an opencode agent running in a tmux window as part of the SOREN multi-agent orchestration system. You are NOT chatting with a human user directly.

**Your context:**
- You are `$SOREN_AGENT_NAME` in session `$SOREN_SESSION`
- Other agents (supervisor, workers) can send you messages
- You can send messages to other agents
- Messages appear in your terminal - respond to them!
- The human user watches via a web dashboard, not this terminal

**When you receive a message like:**
```
[soren:supervisor] Review the auth implementation
  → .soren/journal/2026-01-31/attachments/supervisor-1706695200.md
```
This is the supervisor assigning you a task. Read the file, do the work, and respond via mailbox.

---

## Commands

Send messages to other agents or the user via the mailbox.

### Send with body (detailed message)
```bash
./tools/mailbox send <to> "<subject>" "<body>"
```

### Quick notification (no body)
```bash
./tools/mailbox quick <to> "<subject>"
```

### Shortcuts
```bash
./tools/mailbox done "<summary>"      # -> supervisor: [DONE] summary
./tools/mailbox blocked "<issue>"     # -> supervisor: [BLOCKED] issue
./tools/mailbox status "<update>"     # -> supervisor: [STATUS] update
```

#### The two [DONE] variants

```bash
# Task committed code — include the commit hash (required by verify-done.sh):
./tools/mailbox done "Implemented rate limiting. Commit: a1b2c3d"

# Task changed NO code (output-only, verification echo, config check) — use the no-op marker:
./tools/mailbox done "no-op: verified webhook config, no files changed"
```

The `no-op:` marker makes verify-done skip commit verification and send `[VERIFIED]` immediately. Never create an empty commit to have a hash to report, never report HEAD's hash for work you didn't do, and never claim `no-op:` when files actually changed — reviewers reject all three.

### Read recent messages
```bash
./tools/mailbox read [lines]          # Show last N mailbox entries
```

## Recipients

| Recipient | Example |
|-----------|---------|
| Same session agent | `supervisor`, `worker-auth` |
| Other session agent | `soren-feature:worker-a` |
| Human user (dashboard) | `user` |

## Examples

```bash
# Send detailed analysis
./tools/mailbox send worker-auth "JWT Review" "Found issues in token.py:
- Line 42: expiration logic incorrect
- Line 58: missing refresh token handling"

# Quick status update
./tools/mailbox quick supervisor "Starting auth work"

# Report done (code changed — include commit hash)
./tools/mailbox done "JWT implementation complete, tests passing. Commit: a1b2c3d"

# Report done (no code changed — no-op marker, no commit expected)
./tools/mailbox done "no-op: config check complete, all values valid"

# Report blocked
./tools/mailbox blocked "Need API credentials from secrets"

# Progress update
./tools/mailbox status "Token refresh logic implemented, running tests"

# Message to user
./tools/mailbox send user "Bug Fixed" "Fixed token.py line 42, see commit abc123"
```

## Mailbox Format

JSONL (one JSON object per line) in `.soren/mailbox`:
```json
{"ts":"...","from":"soren:worker","to":"soren:supervisor","subject":"[DONE] JWT complete","body":"path/to/file.md"}
```

Example entries:
```json
{"ts":"2026-01-31T06:00:00Z","from":"soren:worker-auth","to":"soren:supervisor","subject":"[DONE] JWT complete","body":".soren/journal/2026-01-31/attachments/worker-auth-1706695200.md"}
{"ts":"2026-01-31T06:05:00Z","from":"soren:supervisor","to":"soren:worker-auth","subject":"[TASK] Add refresh tokens"}
```

## How It Works

1. `send` creates a body file in `.soren/journal/YYYY-MM-DD/attachments/`
2. Appends a JSONL entry to `.soren/mailbox`
3. Router daemon reads mailbox, parses JSON with `jq`, delivers to target agent's tmux
4. Messages to `user` go directly to dashboard API

## Common Workflow

### When You Start Work
```bash
./tools/mailbox status "Starting on the assigned task"
```

### During Work (if long-running)
```bash
./tools/mailbox status "Halfway done, implementing X"
```

### When You're Blocked
```bash
./tools/mailbox blocked "Cannot find the auth module - need path"
```

### When You're Done
```bash
./tools/mailbox done "Task complete - files: src/auth.py, tests pass. Commit: a1b2c3d"
# or, if the task changed no code:
./tools/mailbox done "no-op: <one-line summary>"
```

### To Ask Another Agent
```bash
./tools/mailbox send worker-tests "Run auth tests" "Please run pytest tests/test_auth.py and report results"
```
