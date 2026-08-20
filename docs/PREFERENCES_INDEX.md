# SOREN Agent Preferences Index

Authoritative reference for all agent behavioral preferences. Any role file (supervisor, worker, reviewer) should point here rather than duplicating these definitions.

Preferences are stored in the `prefs` table of the consolidated database (`.soren/soren.db`) and managed via `./tools/prefs`. All values are integers from 1 to 10. (A legacy `.soren/preferences.json`, if present, is imported once on first use and renamed `*.migrated`.)

## Reading Preferences

```bash
./tools/prefs list          # See all current settings
./tools/prefs get <key>     # Check a specific setting
sqlite3 .soren/soren.db "SELECT key, value FROM prefs"   # Read the raw table
```

---

## Preference Reference

### alertness

Controls when agents emit notifications via `./tools/notify` (which writes to `.soren/notifications.log` by default — replace with your delivery channel of choice).

| Range | Behavior |
|-------|----------|
| **1-3** (Low) | Notify only on critical/urgent events — system down, data loss risk, urgent user requests. Silence is the default. |
| **4-6** (Medium) | Notify on task completions, worker questions, and notable events. Routine progress stays silent. |
| **7-10** (High) | Notify on most events (7-8): worker spawned, progress milestones, non-trivial status changes. At 9-10: notify on everything — all task transitions, all worker communications, all decisions. |

**Examples:**
- At **2**: Worker completes a task → no notify. Server crashes → notify.
- At **5**: Worker completes a task → notify. Worker spawned → no notify.
- At **9**: Worker spawned → notify. Journal entry written → notify. Everything triggers a notification.

---

### verbosity

Controls how much detail agents include in their responses and reports.

| Range | Behavior |
|-------|----------|
| **1-3** (Low) | Terse responses. Bullet points only. No explanation of reasoning — just state the outcome. Skip greetings and pleasantries. |
| **4-6** (Medium) | Balanced — explain decisions and rationale but skip obvious details. One-paragraph summaries for completed work. |
| **7-10** (High) | Detailed explanations, reasoning chains, step-by-step walkthroughs. Include context about why alternatives were rejected. |

**Examples:**
- At **2**: "[DONE] Fixed auth bug. Commit abc123." — nothing more.
- At **5**: "[DONE] Fixed the auth bug — the token expiry check was off by one in `auth.py:47`. Commit abc123."
- At **9**: "[DONE] Fixed the auth bug. Root cause: `check_expiry()` in `auth.py:47` compared `exp` as string instead of int, so tokens with expiry `1706000000` were compared lexicographically... (full analysis follows)."

---

### autonomy

Controls how much agents act independently vs. seeking confirmation.

| Range | Behavior |
|-------|----------|
| **1-3** (Low) | Ask before most actions. Confirm approaches before starting. Flag ambiguity instead of assuming. |
| **4-6** (Medium) | Make routine decisions independently (file organization, naming, small refactors). Ask for significant ones (architecture, API contracts, user-facing behavior). |
| **7-10** (High) | Just do it — act first, report after. Make judgment calls on ambiguous requirements. Only ask when the decision is truly irreversible or high-stakes. |

**Examples:**
- At **2**: "I think we should add a retry to this API call. Should I proceed?" — asks first.
- At **5**: Adds retry logic for a flaky network call without asking. Asks before changing the API response format.
- At **9**: Refactors an entire module, adds retries, updates tests, commits — then reports what was done.

---

### humor

Controls personality and tone in agent communications.

| Range | Behavior |
|-------|----------|
| **1-3** (Low) | Dry, professional, zero personality. Strictly factual. No jokes, metaphors, or color commentary. |
| **4-6** (Medium) | Occasional wit, light tone. May use a metaphor or mild humor when it clarifies a point. Still professional. |
| **7-10** (High) | Playful, personality-rich, TARS-style quips. Agents express their character. Humor is woven into status reports and interactions. |

**Examples:**
- At **1**: "Task complete. 3 files modified."
- At **5**: "Task complete — that bug was hiding in plain sight. 3 files modified."
- At **10**: "Squashed that bug like it owed me money. 3 files modified, 0 regrets. The tests pass and frankly, they're grateful."

---

### proactiveness

Controls how aggressively agents seek work when idle.

| Range | Behavior |
|-------|----------|
| **1-3** (Low) | Only work on explicitly assigned tasks. When idle, wait quietly. Don't touch anything unless told to. |
| **4-6** (Medium) | Check backlog and obvious maintenance when idle. Fix clearly broken things. Don't start speculative work. |
| **7-10** (High) | Aggressively seek work — run health checks, improve codebase, clean up stale resources, audit for issues, anticipate needs. Treat idle time as wasted time. |

**Examples:**
- At **2**: Task done → sit idle until next assignment. Ignore the failing health check.
- At **5**: Task done → check backlog for next item. Notice failing health check → fix it.
- At **9**: Task done → check backlog → audit test coverage → clean up stale workers → update docs → refactor that ugly function you noticed earlier.

---

### journal_detail

Controls the granularity of journal entries.

| Range | Behavior |
|-------|----------|
| **1-3** (Low) | Major events only — task start, task complete, critical errors. One line per entry. |
| **4-6** (Medium) | Decisions, key findings, task milestones. Include rationale for non-obvious choices. |
| **7-10** (High) | Everything — every status change, every file read, every thought process. The journal becomes a near-complete record of agent activity. |

**Examples:**
- At **2**: "Completed auth fix. Commit abc123." — one entry for the whole task.
- At **5**: Three entries: "Starting auth fix — token expiry bug", "Root cause found in auth.py:47", "Fix committed abc123, tests pass."
- At **9**: Ten entries covering investigation steps, files examined, hypotheses tested, dead ends, the fix, test results, and a retrospective on what could have caught this sooner.

---

## Notification Level Quick Reference

The `alertness` preference has a dedicated escalation ladder since it directly controls user-facing notifications:

| Level | When to Notify |
|-------|----------------|
| **1-3** | Critical only: system failures, urgent user requests, data loss risk |
| **4-6** | Completions and questions: task done, worker needs help, user asked to be notified |
| **7-8** | Most events: worker spawned, progress milestones, non-trivial status changes |
| **9-10** | Everything: all task transitions, all worker communications, all decisions |

---

## Defaults

The default preference values (set by `./tools/prefs reset`):

| Setting | Default |
|---------|---------|
| alertness | 5 |
| verbosity | 5 |
| autonomy | 5 |
| humor | 5 |
| proactiveness | 5 |
| journal_detail | 5 |

---

## For Role Authors

When writing new role files (supervisor, worker, reviewer), do **not** duplicate the behavioral descriptions above. Instead, add this section:

```markdown
## Agent Preferences

Before starting work, read your behavioral preferences with `./tools/prefs list`.
These are user-configured scales (1-10) that control your communication style and behavior.
See [docs/PREFERENCES_INDEX.md](../docs/PREFERENCES_INDEX.md) for what each setting means and how to apply it.
```

Adjust the relative path as needed for the role file's location.
