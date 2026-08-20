# Remote Access Runbook

How to run soren as an always-on home server on this Mac and reach it from
anywhere over [Tailscale](https://tailscale.com) — a private mesh VPN. Nothing
is ever exposed to the public internet.

## Architecture

```
  phone / laptop (anywhere)
        │
        │  tailnet HTTPS (WireGuard-encrypted, tailnet-only)
        ▼
  https://<machine>.<tailnet>.ts.net
        │
        │  tailscale serve (reverse proxy on this Mac)
        ▼
  http://127.0.0.1:8000  ←  FastAPI server (loopback bind, deliberate)
        │
        └─ dashboard (has its own auth)

  Full control path (separate from the dashboard):
  ssh <user>@<machine>  →  tmux attach -t soren  →  supervisor + workers
```

Two invariants make this safe:

1. **The server binds `127.0.0.1:8000` only.** It is never reachable from the
   LAN or internet directly. Remote access exists *only* because `tailscale
   serve` proxies the tailnet HTTPS endpoint to loopback.
2. **Tailscale serve is tailnet-only.** It is not `tailscale funnel` — no
   public exposure. Only devices signed into your tailnet can connect.

## The two-CLI footgun (read this first)

This Mac runs **Tailscale.app** (the GUI / NetworkExtension variant). Its CLI
lives inside the app bundle:

```
/Applications/Tailscale.app/Contents/MacOS/Tailscale
```

The homebrew formula also installs a CLI at `/opt/homebrew/bin/tailscale`,
but that one talks to a **different daemon socket** (the standalone
`tailscaled`). Used against the app's daemon it will report "failed to
connect", show stale state, or start managing a second daemon. **Never use
the homebrew CLI on this machine.** All soren tooling (`tools/server-boot`,
`./soren.sh server status`, `./soren.sh doctor`) hardcodes the app CLI path.

Suggested shell alias:

```bash
alias tailscale="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
```

## One-time setup checklist

> **Shortcut:** `./tools/server-setup` runs all of the steps below
> interactively (sudo prompts included), is idempotent, sets the tailscale
> hostname to `terminal` (override with `--hostname <name>`), and opens the
> Serve/HTTPS enablement page automatically when tailscale requires it.
> The manual steps remain documented for reference.

1. **Sign in to Tailscale.app** — `open -a Tailscale`, sign in from the menu
   bar icon. Verify: `"/Applications/Tailscale.app/Contents/MacOS/Tailscale" status`
   lists this machine.
2. **Enable MagicDNS + HTTPS certs** in the Tailscale admin console
   (<https://login.tailscale.com/admin/dns>): turn on MagicDNS and "HTTPS
   Certificates". Required for the `https://<machine>.<tailnet>.ts.net` URL.

   > **`serve --bg 8000` hangs?** That is cert provisioning blocked on the
   > HTTPS toggle above. Until it is enabled, use the plain-HTTP variant —
   > still tailnet-only, just not TLS:
   > ```bash
   > "/Applications/Tailscale.app/Contents/MacOS/Tailscale" serve --http=80 --bg 8000
   > ```
   > Dashboard is then at `http://<machine>.<tailnet>.ts.net`. After enabling
   > HTTPS certs, upgrade: `... serve --http=80 off && ... serve --bg 8000`.
3. **Enable Remote Login (SSH)**:
   ```bash
   sudo systemsetup -setremotelogin on
   ```
   > On modern macOS this fails unless your terminal app has **Full Disk
   > Access** (verified on this machine). Fallbacks, in order — the launchctl
   > route (works on some FDA-blocked configs):
   > ```bash
   > sudo launchctl enable system/com.openssh.sshd
   > sudo launchctl bootstrap system /System/Library/LaunchDaemons/ssh.plist
   > ```
   > or flip **Remote Login** on manually in System Settings → General →
   > Sharing. `tools/server-setup` tries all three in that order and verifies
   > with a port-22 probe.
4. **Never sleep on AC power** (display may sleep; the machine must not):
   ```bash
   sudo pmset -c sleep 0 displaysleep 10
   ```
5. **Install the launchd boot agent** (starts soren at login, idempotent):
   ```bash
   ./soren.sh server install
   ```
   > Note: launchd *LaunchAgents* run at login. For unattended reboots,
   > enable automatic login for this user (System Settings → Users & Groups),
   > or FileVault will hold the boot at the login screen.
6. **Configure tailscale serve** (persists across reboots; `server-boot` also
   does this best-effort on every boot):
   ```bash
   "/Applications/Tailscale.app/Contents/MacOS/Tailscale" serve --bg 8000
   ```
   Verify: `... Tailscale serve status` should show
   `proxy http://127.0.0.1:8000`.
7. **Check everything**: `./soren.sh server status` and `./soren.sh doctor`
   (the doctor grows a "Server mode" section once the plist exists; force it
   with `./soren.sh doctor --server`).

## Direct SSH (VM-style access)

Once Remote Login is on, this Mac behaves like a VM you can reach from any
tailnet device: MagicDNS resolves `terminal`, sshd answers on :22, and :22 is
reachable only from the LAN and the tailnet — nothing is port-forwarded.

### The three access layers

Three different front doors that are easy to conflate (this exact confusion
has happened live — keep them straight):

| # | Layer | How | What you get |
| --- | --- | --- | --- |
| 1 | Raw SSH | `ssh pankajgarkoti@terminal` | A plain login shell — the machine as a VM. tmux is **not** involved; soren keeps running untouched in the background. |
| 2 | Agent session | `ssh -t terminal 'tmux attach -t soren'` | The **same live session** the Mac's own screen shows. tmux is client/server: every attach joins the SAME session — keystrokes and output are shared with anyone else attached. |
| 3 | Browser | `https://terminal.<tailnet>.ts.net` | Dashboard + web terminal (modes: **Shell** / **Soren session**) — no SSH client needed. |

Layer-2 variants:

```bash
ssh -t terminal 'tmux attach -t soren'        # join the shared session (mirrored view)
ssh -t terminal 'tmux new-session -t soren'   # grouped session: same windows, independent focus
ssh -t terminal 'tmux attach -rt soren'       # read-only attach (watch, cannot type)
```

### Laptop client setup (once per device)

1. Install the Tailscale app and sign in to the same tailnet.
2. Create a key if you don't have one, then copy it over (the last password
   prompt you should ever see):
   ```bash
   ssh-keygen -t ed25519              # accept defaults; skip if ~/.ssh/id_ed25519 exists
   ssh-copy-id pankajgarkoti@terminal
   ```
3. Add to `~/.ssh/config`:
   ```
   Host terminal
       HostName terminal
       User pankajgarkoti
       ServerAliveInterval 30
       ServerAliveCountMax 4

   # Optional: `ssh soren` drops straight into the live agent session
   Host soren
       HostName terminal
       User pankajgarkoti
       ServerAliveInterval 30
       ServerAliveCountMax 4
       RequestTTY yes
       RemoteCommand tmux attach -t soren
   ```

Now `ssh terminal` is the VM shell (layer 1) and `ssh soren` is the live
agent session (layer 2).

### sshd hardening (recommended once key login works)

Verify key-based `ssh terminal` works **first**, then disable password auth
on the Mac:

```bash
sudo mkdir -p /etc/ssh/sshd_config.d
sudo tee /etc/ssh/sshd_config.d/soren.conf >/dev/null <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
AllowUsers pankajgarkoti
CONF
sudo launchctl kickstart -k system/com.openssh.sshd   # reload sshd
```

macOS's stock `sshd_config` ends with `Include /etc/ssh/sshd_config.d/*`, so
the drop-in survives OS updates. Remember: :22 is only reachable from the LAN
and the tailnet (no router port-forwards), so this is defense in depth, not
the only line. `./soren.sh doctor --server` warns if password auth is still
enabled. `tools/server-setup` prints this exact block once SSH is detected on.

### Extras

- **VS Code Remote-SSH**: install the "Remote - SSH" extension, connect to
  host `terminal` — full IDE against the server's checkout.
- **mosh** (flaky mobile links): `brew install mosh` on both ends, then
  `mosh terminal` — sessions survive network changes / sleep; UDP flows fine
  tailnet-internally.
- **File transfer**:
  ```bash
  scp report.pdf terminal:~/Desktop/                      # push a file
  scp terminal:~/Desktop/code/soren/.soren/status.log .   # pull a file
  rsync -avz terminal:~/Desktop/code/soren/.soren/journal/ ./journal-backup/
  ```

## Daily use

- **Dashboard**: `https://<machine>.<tailnet>.ts.net` from any tailnet device
  (e.g. `https://terminal.<tailnet>.ts.net`). Dashboard auth stays
  on — log in as usual.
- **Web terminal** (in the dashboard): **Shell** mode opens a plain login
  shell on the Mac — raw SSH in the browser; **Soren session** mode attaches
  to the same live `soren` tmux session the Mac's screen shows.
- **Command Center**: use `@agent-name` routing in the dashboard's Command
  Center to message the supervisor or direct a specific agent.
- **Full control via SSH**:
  ```bash
  ssh <user>@<machine>          # tailnet MagicDNS name or 100.x address
  cd ~/Desktop/code/soren
  tmux attach -t soren          # watch/drive the whole system
  # detach without stopping anything: Ctrl+b then d
  ```
  Client setup, attach variants, and hardening: see
  [Direct SSH (VM-style access)](#direct-ssh-vm-style-access) above.
- **Quick checks over SSH**: `./soren.sh status`, `./soren.sh health`,
  `./soren.sh server status`, `./soren.sh logs server`.

## Phone use

- Install the **Tailscale iOS app**, sign in to the same tailnet, toggle the
  VPN on.
- Open the dashboard in Safari: `https://<machine>.<tailnet>.ts.net`. Add to
  Home Screen for an app-like experience.
- Optional: SSH from the phone with **Termius** or **Blink Shell**, then
  `tmux attach -t soren` as above.

## Troubleshooting

| Symptom | Diagnosis / fix |
| --- | --- |
| App CLI says "failed to connect" / daemon not running | Tailscale.app isn't running: `open -a Tailscale`, sign in if needed. |
| CLI output looks wrong or contradicts the menu bar | You used `/opt/homebrew/bin/tailscale`. Use the app CLI (see the two-CLI footgun above). |
| Dashboard URL returns **502** | `tailscale serve` is fine but soren isn't healthy behind it. SSH in, check `.soren/logs/server-boot.log` and `./soren.sh doctor`; restart with `./soren.sh restart` if needed. |
| Dashboard URL times out entirely | Client not on the tailnet (VPN toggle off), or serve not configured: `... Tailscale serve status`. |
| Mac rebooted, nothing came back | The chain is: login → launchd `com.computerreinvention.soren` → `tools/server-boot` → `soren.sh start` (detached) → tailscale serve. Check each: `./soren.sh server status`, then `.soren/logs/server-boot.log`. If the plist isn't loaded, re-run `./soren.sh server install`. If the Mac is stuck at the FileVault login screen, launchd agents haven't run yet. |
| Away-from-home recovery | SSH in over the tailnet, then: `./soren.sh doctor`, `./tools/verifications` for deeper checks, and follow the recovery-ops skill for restart/rollback procedures. Worst case: `./soren.sh restart` or `src/orchestrator/detached-restart.sh --restart --detach`. |
| `soren.sh start` killed my session when I hung up | Known quirk: foreground `start` tears down the tmux session via exit-trap when its process dies. Always start detached — `tools/server-boot` does this for you (`nohup` + `disown`). |

## Security notes

- **Loopback binding is an invariant.** The FastAPI server binds
  `127.0.0.1:8000` deliberately. Never set `SOREN_HOST=0.0.0.0` on this
  machine — remote exposure is `tailscale serve`'s job, and it terminates
  TLS with tailnet-only reachability.
- **Tailnet-only, never public.** Use `serve`, never `funnel`. Do not
  port-forward 8000 (or 22) on the router. There is no public attack surface
  by design.
- **Dashboard auth stays on** even though the tailnet is private —
  defense in depth against a compromised tailnet device.
- **SSH access equals full control** (tmux session, agents, secrets). Guard
  tailnet membership accordingly; review devices in the admin console.
