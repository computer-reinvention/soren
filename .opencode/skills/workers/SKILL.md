---
name: workers
description: Spawn, manage, and communicate with worker agents. Use when you need to create a new worker, kill a worker, list workers, or send messages to workers.
---

# Worker Management

Use the `workers` tool to manage worker agents. This is the **only** way to spawn workers - do not use raw tmux commands.

## Commands

### Spawn a new worker
```bash
./tools/workers spawn "<worker-name>" "<task description>"
```

### List all workers
```bash
./tools/workers list
```

### Send a message to a worker
```bash
./tools/workers send "<worker-name>" "<message>"
```

### Check worker status (terminal output)
```bash
./tools/workers status "<worker-name>" [lines]
```

### Kill a worker
```bash
./tools/workers kill "<worker-name>"
```

## Spawning Workers: Use Templates

When spawning a worker, **always include role instructions** by referencing the appropriate template:

```bash
./tools/workers spawn "auth-worker" "Read docs/WORKER_ROLE.md for your role instructions, then: Implement JWT authentication in src/server/auth.py"
```

For specialized tasks, point to relevant documentation:
- `docs/WORKER_ROLE.md` - General worker instructions
- `docs/SUPERVISOR_ROLE.md` - If spawning a sub-supervisor
- `CLAUDE.md` - Project conventions and commands

## Communication Protocol

### Message Format
When sending messages to workers, use this structure:

```
[TYPE] message content
```

Types:
- `[TASK]` - New task assignment
- `[UPDATE]` - Additional context or changed requirements
- `[QUESTION]` - Asking for status or clarification
- `[PRIORITY]` - Urgent task or blocker
- `[COMPLETE]` - Acknowledge completion, worker can finish

### Examples

**Assigning follow-up work:**
```bash
./tools/workers send "auth-worker" "[UPDATE] Also add refresh token support with 7-day expiry"
```

**Checking progress:**
```bash
./tools/workers send "auth-worker" "[QUESTION] What's your current progress? Any blockers?"
```

**Marking complete:**
```bash
./tools/workers send "auth-worker" "[COMPLETE] Task verified. Please commit your changes and exit."
```

### Worker Responses
Workers communicate back via the mailbox system. Check `.soren/mailbox` or the dashboard for responses.

Workers should send:
- `[STATUS]` - Progress updates
- `[BLOCKED]` - When stuck and need help
- `[DONE]` - Task completed
- `[QUESTION]` - Need clarification

## Best Practices

1. **Use descriptive names**: `auth-worker`, `frontend-fix`, `api-refactor`
2. **Reference templates**: Always tell workers to read their role docs first
3. **Give clear tasks**: Include file paths, specific requirements, and success criteria
4. **Check status regularly**: Use `workers status <name>` to monitor progress
5. **Clean up**: Kill workers when they complete their tasks
