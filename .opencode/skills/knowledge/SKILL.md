---
name: knowledge
description: Record and retrieve durable per-agent working knowledge — lessons, patterns, pitfalls, decisions that survive context resets. Use when adding a lesson after verified work (knowledge add), loading expertise at task start (knowledge show), or condensing a large file (knowledge distill).
---

# Working Knowledge - Durable Specialist Memory

Permanent workers are **specialized but amnesiac** — context resets (every ~5 tasks / 3 hours) wipe everything learned in-session. Knowledge files are the fix: per-agent, git-versioned markdown at `templates/team/knowledge/<agent_id>.md` that survives resets, rollbacks, and restarts. They are the difference between a specialist and a fresh spawn — a specialist with an empty knowledge file is just a generalist with a personality.

**Journal vs knowledge:** the journal is a chronological record of *what happened*; the knowledge file is a distilled record of *what stays true*. Task narration goes in the journal; durable invariants go here.

## The Habit

```bash
# At the START of any task — 10 seconds, loads accumulated expertise
./tools/knowledge show <your-agent-id>

# After [VERIFIED] — record one durable lesson (skip only if the task taught nothing)
./tools/knowledge add <your-agent-id> "mailbox writes need the async lock — raw appends corrupt the queue"
```

At spawn, `soren.sh team up` injects the knowledge file into the worker's role context automatically — but mid-session, `knowledge show` is how you refresh.

## Commands

```bash
./tools/knowledge add <agent_id> "<lesson>" [--section <s>]   # Append a dated lesson
./tools/knowledge show <agent_id> [--brief]                   # Show file (--brief: last 15 entries)
./tools/knowledge list                                        # Table: agent, entries, last updated
./tools/knowledge distill <agent_id>                          # Print distill instructions
```

`agent_id` must match a role template (`templates/team/<agent_id>-role.md`) or an existing knowledge file (covers retired roles). First `add` creates the file from a template.

### Section routing

`--section` picks where the entry lands (default: `patterns`):

| Section | Header | For |
|---------|--------|-----|
| `patterns` | `## Patterns` | reusable approaches, invariants ("X breaks when Y") |
| `pitfalls` | `## Pitfalls` | things that bit you |
| `decisions` | `## Decisions` | choices + rationale |
| `domain` | `## Domain Map` | ownership/architecture map changes |

```bash
./tools/knowledge add perm-frontend "dark mode regressions cluster in activity/" --section pitfalls
./tools/knowledge add perm-infra "chose flock over mkdir locks for tools/lock" --section decisions
```

## Behavior to Know

- **Dedupe**: exact-duplicate lessons (fixed-string match anywhere in the file) are refused with an error
- **Dated entries**: stored as `- [YYYY-MM-DD] <lesson>` at the end of the target section
- **Size warning**: past 150 content lines, `add` warns to run `distill`
- **Git-versioned**: files are repo-tracked — commit knowledge changes; they are reviewable in PRs and survive rollbacks

## Distill Workflow

`knowledge distill <agent_id>` does **not** auto-summarize — judgment about what is still true belongs to the specialist, not a script. It prints instructions; the agent then:

1. Reads the whole file, merges duplicate/overlapping lessons
2. Drops obsolete entries (code changed, tool removed, rule superseded) — when in doubt, keep
3. Keeps hard-won invariants verbatim (production failures, rejected reviews)
4. Preserves the section structure and `- [YYYY-MM-DD]` format, targets under 100 lines
5. Commits: `git add templates/team/knowledge/<id>.md && git commit -m "chore(knowledge): distill <id>"`

## When NOT to Add

- **Trivia** — anything you'd find in 10 seconds of reading the file in question
- **Task-specific details** — "fixed the login bug in commit abc123" belongs in the journal
- **One-off state** — port numbers du jour, current branch names, in-flight task context
- **Unverified hunches** — record lessons after work is verified, not while guessing
