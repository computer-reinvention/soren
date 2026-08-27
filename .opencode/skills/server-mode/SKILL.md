---
name: server-mode
description: Flip this Mac between "always-on soren server" and "normal laptop" mode — sleep settings, SSH, launchd boot agent, and tailscale serve, all in one command. Use when the human asks to turn this machine into a server or back to a normal laptop.
---

# Server Mode - Always-On Toggle

Composes existing tooling rather than duplicating it: `soren.sh server install/uninstall`, `server-boot`, and the app-bundle tailscale CLI. Requires `server-setup` to have been run once first (tailnet login, MagicDNS/HTTPS, hostname).

## Commands

```bash
./tools/server-mode on  [--skip-sudo]
./tools/server-mode off [--skip-sudo] [--keep-ssh] [--force]
./tools/server-mode status
```

## ON (server)

- Never sleeps (lid can be closed on AC power)
- Remote Login (SSH) enabled
- launchd boot agent installed (`server-boot` runs at every login)
- soren started detached
- `tailscale serve` → `127.0.0.1:$SOREN_PORT`
- Prints access info (tailnet URL) when done

## OFF (laptop)

- soren stopped
- launchd boot agent removed
- `tailscale serve` cleared
- Remote Login disabled (unless `--keep-ssh`)
- Sleep settings restored to normal laptop defaults
- Tailscale itself is left running — it's normal laptop kit, not server-specific

## Flags

- `--skip-sudo` — never invoke `sudo`; prints the equivalent manual commands instead of running them
- `--keep-ssh` (off only) — leave Remote Login enabled
- `--force` (off only) — proceed even when run over an SSH connection that would itself get cut by disabling Remote Login

## When to Use

- Human says "turn this into a server" / "make this always-on" → `server-mode on`
- Human says "I want my laptop back to normal" → `server-mode off`
- Unsure what state the machine is in → `server-mode status` first, always safe
