---
name: server-boot
description: Idempotent boot entrypoint for always-on server mode, run automatically by launchd at login. Rarely invoked manually — understand it when debugging why soren didn't come back up after a reboot.
---

# Server Boot - Launchd Entrypoint

Installed as a launchd `RunAtLoad` agent by `server-mode on` (or `server-setup`). Runs at every login on a machine configured as an always-on server. Safe to run by hand at any time — if soren is already healthy, it does nothing.

## What It Does, in Order

1. Waits for the network to come up (max 60s)
2. If soren already answers healthy on `127.0.0.1:$SOREN_PORT` → logs and exits 0 (the tailscale `serve --bg` config persists across reboots on its own, nothing else needed)
3. Otherwise starts soren fully **detached** (`nohup` + `disown`) — never runs `soren.sh start` in the launchd foreground, since its tmux session gets torn down by an exit-trap the moment the foreground process is killed
4. Waits up to 90s for health, logs the outcome either way
5. Best-effort: ensures `tailscale serve` proxies the tailnet HTTPS endpoint to `127.0.0.1:$SOREN_PORT`, using the **Tailscale.app bundled CLI only** — never the homebrew formula CLI, which talks to a different daemon socket. Tailscale failures are logged and skipped, never fail the boot.

Logs: `.soren/logs/server-boot.log`

## When You'd Touch This

- Debugging why soren didn't come back up after a machine restart — check `.soren/logs/server-boot.log` first, this is what launchd actually ran
- Testing the boot path without rebooting: run it by hand, it's idempotent
- You should not normally need to invoke it directly in day-to-day operation — it's infrastructure, not a task tool. See the `server-mode` skill for turning always-on mode on/off, and `server-setup` for the one-time prerequisites.
