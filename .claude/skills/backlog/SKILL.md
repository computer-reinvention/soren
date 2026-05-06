---
name: backlog
description: Manage the persistent task backlog for supervisor autonomy. Use when you need to add, list, claim, complete, skip, or reprioritize backlog items.
allowed-tools: Bash(./tools/backlog:*)
---

# Backlog - Persistent Work Queue

The backlog is the supervisor's **autonomous work queue**. When idle, check the backlog for the next task. When tasks emerge, add them to the backlog.

## When to Use

- **After completing a task** — check `backlog next` for more work
- **When discovering work** — add items with `backlog add`
- **During maintenance sweeps** — process or triage backlog items
- **When a user requests something non-urgent** — add to backlog instead of doing immediately

## Commands

### Add an item
```bash
./tools/backlog add "Fix auth bug" "Token expiry broken in production" 1 user
./tools/backlog add "Run test suite" "Full pytest run and fix failures" 3
./tools/backlog add "Clean up stale files" "Remove orphaned worker contexts" 4 self
```

Arguments: `"<title>" "<description>" [priority 1-5] [source: user|system|self]`
Priority defaults to 3, source defaults to "system".

### List items
```bash
./tools/backlog list            # Pending items, sorted by priority
./tools/backlog list all        # All items regardless of status
./tools/backlog list completed  # Completed items
```

### Claim the next item
```bash
./tools/backlog next    # Returns top pending item, marks it in_progress
```

### Complete / skip
```bash
./tools/backlog complete 3    # Mark item #3 done
./tools/backlog skip 5        # Mark item #5 skipped
```

### Reprioritize
```bash
./tools/backlog prioritize 2 1    # Bump item #2 to critical (P1)
```

### Show details
```bash
./tools/backlog show 3    # Full details for item #3
```

## Priority Scale

| Priority | Label    | Meaning                            |
|----------|----------|------------------------------------|
| 1        | Critical | Blocking issue, do immediately     |
| 2        | High     | Important, do soon                 |
| 3        | Medium   | Standard priority (default)        |
| 4        | Low      | Nice to have, do when idle         |
| 5        | Backlog  | Someday/maybe, lowest priority     |

## Tips

- **Check backlog before going idle** — there's almost always something to do
- **Add discovered work immediately** — don't rely on memory
- **Use `self` source** for items the supervisor discovers on its own
- **Keep descriptions actionable** — another agent should be able to pick up any item
