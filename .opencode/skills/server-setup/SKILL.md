---
name: server-setup
description: One-shot interactive setup for the remote-access prerequisites (SSH, launchd, tailscale hostname/HTTPS) that server-mode depends on. Use once before the first server-mode on.
---

# Server Setup - One-Time Remote Access Prerequisites

Performs the manual steps from `docs/REMOTE_ACCESS.md` so `server-mode on` has something to toggle. Idempotent — safe to re-run if a step needs redoing.

## What It Does, in Order

1. Enable Remote Login (SSH) — `sudo`
2. Never sleep on AC power — `sudo`
3. Install the launchd boot agent (`soren.sh server install`)
4. Set the tailscale hostname (default: `terminal`)
5. Enable `tailscale serve` (HTTPS, HTTP fallback) via the app-bundle CLI
6. Final check: `soren.sh doctor --server`

## Commands

```bash
./tools/server-setup [--hostname <name>] [--skip-sudo]
```

`--skip-sudo` prints the equivalent manual commands instead of running them with `sudo` — useful if you want to review before granting elevated access, or you're not the one with sudo rights on this machine.

## When to Use

- Once, before the very first `server-mode on` on a fresh machine
- Re-run any time to confirm/repair the prerequisites (e.g. after a macOS update reset a setting) — it's idempotent, not a one-shot-only script despite the name
- After this succeeds, use the `server-mode` skill for the actual on/off toggle going forward
