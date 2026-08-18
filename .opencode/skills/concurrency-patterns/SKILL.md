---
name: concurrency-patterns
description: Recognize and prevent race conditions, use locking correctly, avoid async pitfalls, and design queues. Load when code involves shared state, async tasks, files written by multiple processes, or background workers.
---

# Concurrency Patterns

Concurrency bugs don't fail in tests; they fail at 3am under load. The only winning move is designing them out.

## Race Conditions — Spotting Them

Any **check-then-act** sequence on shared state is a race:

```python
if not os.path.exists(lockfile):   # another process passes this check
    create(lockfile)               # ...at the same time you do
```

Same shape everywhere: read-modify-write on a JSON file, `SELECT` then `INSERT`, "if worker idle then assign". The window between check and act is where two actors collide.

**Fixes, in order of preference:**
1. **Make it atomic** — one operation that checks and acts: `INSERT ... ON CONFLICT`, `os.open(path, O_CREAT|O_EXCL)`, `mkdir` (atomic on POSIX), atomic rename (`write tmp → os.rename`).
2. **Serialize through one owner** — a single writer process/task owns the state; everyone else sends messages (this is the SOREN mailbox model).
3. **Lock** — last resort, because now you own deadlocks and stale locks.

## Locking Rules

- Acquire the narrowest lock for the shortest time. Never hold a lock across network I/O or a subprocess call.
- One lock order, everywhere. Two locks acquired in different orders by two paths = eventual deadlock.
- File locks in shell: use `tools/lock` or `mkdir`-based locks; always `trap` cleanup so a crashed holder doesn't wedge the system. Stale-lock detection needs a timestamp + owner PID.
- Re-check state *after* acquiring the lock — the world changed while you waited.

## Async Pitfalls (Python / JS)

- **Fire-and-forget tasks vanish**: `asyncio.create_task()` without keeping a reference can be garbage-collected mid-flight, and its exceptions are silently dropped. Keep references; add done-callbacks that log exceptions.
- **Blocking the loop**: any sync I/O (file read, `requests`, sqlite call) inside `async def` freezes every coroutine. Use executors or async drivers.
- **`await` is a yield point**: shared state can change across every `await`. Code that was safe as a sync block becomes racy the moment you insert an await in the middle.
- **JS**: unawaited promises swallow rejections; `Promise.all` fails fast (one rejection cancels nothing — the rest keep running). Use `allSettled` when partial success matters.
- Timeouts on everything that awaits the outside world. An await with no timeout is a permanent hang waiting to happen.

## Queues

- A queue decouples producers from consumers — but only if you decide, upfront: bounded or unbounded? What happens when full (block, drop, dead-letter)? Unbounded queues turn overload into memory exhaustion.
- Design consumers for **at-least-once** delivery: messages WILL be redelivered. Handlers must be idempotent (dedupe key, upsert semantics).
- Poison messages: a message that always crashes its consumer will block the queue forever unless you count attempts and dead-letter it.
- File-based queues (SOREN mailbox): append atomically (single `write` of one full line, JSONL), consume via rename-to-processing, never edit in place.

## Checklist

1. Every shared file/table write: atomic op, single owner, or lock — which one, and why?
2. Every `create_task`/promise: someone awaits it or logs its failure.
3. Every external await has a timeout.
4. Every queue consumer is idempotent and bounds retries.
5. Ran the "two of me at once" thought experiment on the critical path.

## Anti-Patterns

- `sleep(1)` as synchronization — it's a race with a fuse.
- Retry loops without jitter/backoff — synchronized stampedes.
- Locks held across `await`.
- "It's single-threaded so it's safe" — async interleaving and multiple processes break this daily.
