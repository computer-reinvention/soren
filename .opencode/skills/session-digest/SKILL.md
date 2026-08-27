---
name: session-digest
description: Print a concise health + audit + priorities briefing in one command, meant for supervisor session start. Use at the beginning of a session to orient quickly instead of querying each endpoint separately.
---

# Session Digest - Startup Briefing

A single readable summary combining the scorecard, a quick system-audit pass, and (typically) top priorities — designed to replace several separate manual checks at the start of a session.

## Commands

```bash
./tools/session-digest
```

No flags — it's a fixed briefing, not a configurable report. Output includes:
- **Health**: uptime, tasks completed today, budget usage %, active/sleeping agent counts (from `/api/webhooks/scorecard`)
- **Audit**: a quick `system-audit --quick --json` pass, summarized

## When to Use It

- First thing at supervisor boot or after waking from sleep, before diving into the mailbox — gives you the "is anything on fire" picture in one shot
- After a restart, to confirm health quickly without manually curling three different endpoints
