# Solo Worker

The simplest team structure: a single worker executing a focused task.

## When to Use

- Simple, focused tasks
- Bug fixes with clear scope
- Small feature additions
- Documentation updates
- Tasks that don't need coordination

## Org Chart

```
    ┌─────────────┐
    │ Supervisor  │
    └──────┬──────┘
           │
    ┌──────▼──────┐
    │   Worker    │
    └─────────────┘
```

## Communication

```bash
# Worker status updates
./tools/mailbox status "Found the bug in auth.py:142"
./tools/mailbox status "Fix applied, running tests"

# Worker completion
./tools/mailbox done "Fixed auth bug. Tests passing."

# Worker blocked
./tools/mailbox blocked "Need access to production logs"
```

## Spawning Command

```bash
./tools/workers spawn "fix-auth" "Fix the authentication timeout bug in src/server/services/auth.py. Run tests before reporting done."
```

## Example Tasks

- "Fix the typo in the README"
- "Add a health check endpoint"
- "Update the login form validation"
- "Rename all references to X as Y"
- "Add logging to the webhook handler"

## Decision Authority

| Decision Type | Who Decides |
|---------------|-------------|
| How to fix | Worker |
| When done | Worker reports, Supervisor confirms |
| Scope expansion | Escalate to Supervisor |

## Testing Checkpoint (MANDATORY)

Before reporting `[DONE]`, the worker MUST complete the testing checkpoint:

1. **Detect project type** (see `docs/WORKER_ROLE.md` — Mandatory Testing section)
2. **Run appropriate tests**:
   - Web project → Browser test via Chrome MCP (navigate, snapshot, screenshot)
   - API project → Run pytest AND curl endpoints
   - CLI project → Run the tool and show output
3. **Include evidence** in the `[DONE]` message (screenshot path, test output, or demo script)

**A solo worker reports [BLOCKED] if they cannot verify their work — never [DONE] without testing.**

## When NOT to Use

- Tasks requiring frontend + backend coordination (use Squad)
- Design decisions with tradeoffs (use Debate)
- Urgent production issues (use Tiger Team)
- Large features (use Feature Team)
