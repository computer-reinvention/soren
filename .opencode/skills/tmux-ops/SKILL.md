---
name: tmux-ops
description: Operating tmux sessions and windows safely in this system - inspection, capture, send-keys discipline, and what never to touch.
---

# tmux Operations

SOREN runs every agent in a tmux window of the `soren` session. tmux is the
system's process fabric — treat it as production infrastructure.

## Inspection (always safe)

```bash
tmux list-sessions
tmux list-windows -t soren -F '#{window_name} #{pane_pid}'
tmux capture-pane -t soren:<window> -p -S -50     # last 50 lines of a pane
tmux display-message -t soren:<window> -p '#{pane_current_command}'
```

Capture before you conclude: a "stuck" agent is often mid-generation. Check
for busy indicators before intervening.

## Sending input (dangerous — follow the discipline)

- Prefer the HTTP path: agents expose `/tui/append-prompt` + `/tui/submit-prompt`
  on their `oc_port` (see `.soren/agent_registry.json`). `tools/workers send`
  and `tmux_send_keys` in `src/orchestrator/lib/tmux.sh` already do this —
  use the tools, not raw send-keys.
- If you must send raw: text and Enter are SEPARATE sends
  (`send-keys -l "text"` then `send-keys Enter`), never interpolate
  untrusted content into the target spec.
- Never send to a window without knowing what runs in it.

## Window lifecycle

- Agent windows are created/killed by `tools/workers` — never
  `kill-window` an agent directly; use `workers kill|sleep <name>`
  (they archive conversations and release ports first).
- The `monitor` window IS the recovery system. Never kill it, never
  send keys to it.
- Human windows in the session are not agents — don't message them.

## Sessions

- `soren` is the system session; `soren-*` are spawned sub-sessions.
- Attach read-only style: observe, detach (`Ctrl+b d`). Don't type into
  agent panes directly — that injects untracked messages into their context.

## Anti-patterns

- `tmux kill-server` — kills every session on the machine including the user's.
- Sending multiline text via send-keys (paste-buffer issues) — write a file
  and send a one-line "read <path>" pointer, or use the HTTP path.
- Polling capture-pane in a tight loop — 1s+ intervals, always.
