---
name: notify
description: Emit a leveled notification (info/warning/alert), gated by the alertness preference. Use to surface something to the human outside the normal mailbox/dashboard flow — the delivery channel is swappable per install.
---

# Notify - Leveled Notifications

Appends a line to `.soren/notifications.log` by default. This is a template — the body is meant to be replaced with a real delivery channel (Telegram, Slack, email, push) per install; don't assume the log file is actually being watched unless you've confirmed it.

## Commands

```bash
./tools/notify "<message>"                    # level: info (default)
./tools/notify "<message>" --level warning
./tools/notify "<message>" --level alert
```

## Gate on `alertness` First

Don't call this reflexively — check the `alertness` preference (see the `prefs` skill) before deciding whether and how loudly to notify:
```bash
./tools/prefs get alertness
```
Low `alertness`: reserve `alert`-level for genuinely important events only. High `alertness`: fine to notify liberally, including on routine progress.

## When to Use It

- Something the human would want to know about right now, not just find later in the journal or mailbox — a deploy finished, an error rate spiked, a long-running task completed
- Not a replacement for `mailbox send user` (which reaches the dashboard) — this is for out-of-band alerting when a delivery channel is actually wired up. If in doubt which to use, prefer the mailbox; it's guaranteed to reach the dashboard the human is already watching.
