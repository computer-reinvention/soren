---
name: journal
description: Write journal entries to maintain persistent memory across sessions. Use frequently - after completing tasks, making decisions, encountering issues, or learning something notable.
allowed-tools: Bash(./tools/journal:*)
---

# Journal - Persistent Memory

The journal is your **long-term memory**. Entries survive compaction, restarts, and rollbacks. If you don't journal it, it's lost.

## When to Journal

**Journal instinctively.** If something is worth remembering, write it down immediately. Don't wait.

- After completing a task or subtask
- When you make a decision (and why)
- When you encounter and resolve an issue
- When you learn something about the codebase
- When you start or finish a significant piece of work
- When you're blocked and need to capture context

## Commands

### Quick log (use this 90% of the time)
```bash
./tools/journal log "Fixed auth bug - token expiry was using local time instead of UTC"
```

### Detailed note
```bash
./tools/journal note "Auth Investigation" "Found three issues in token.py..."
```

### Decision record
```bash
./tools/journal decision "Use JSONL for mailbox" "Eliminates all parsing ambiguity while keeping file-based resilience"
```

### Read journal
```bash
./tools/journal read              # Today
./tools/journal read 2026-02-18   # Specific date
./tools/journal dates             # List all dates
```

## Tips

- **Be specific**: "Fixed off-by-one in pagination query, was using < instead of <=" beats "Fixed bug"
- **Include the why**: Future you (or another agent) needs context
- **One line is fine**: `journal log "..."` takes 2 seconds. Do it often.
- **Don't journal routine**: No need to log "read a file" or "ran tests". Journal the *outcome*.
