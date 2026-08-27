---
name: prefs
description: Check and adjust TARS-style behavioral preferences (verbosity, autonomy, humor, journal detail, etc). Use at the start of a task to calibrate tone and behavior, or when the human asks you to be more/less of something.
---

# Preferences - Behavioral Calibration

A small set of 1-10 dials that shape how every agent behaves, stored in the `prefs` table (`.soren/soren.db`) and shared with the dashboard (`/api/prefs`). TARS-style: adjustable, not fixed personality.

## Check at the Start of Any Task

Ten seconds, no excuse to skip it:
```bash
./tools/prefs list
```

## Settings

| Setting | Meaning |
|---|---|
| `alertness` | How often to alert the user with sound/voice notifications |
| `verbosity` | How detailed responses should be (1=terse, 10=explain everything) |
| `autonomy` | How much to do without asking (1=ask everything, 10=just do it) |
| `humor` | How playful vs. dry the tone is |
| `proactiveness` | How aggressively to find work when idle |
| `journal_detail` | How much to journal (1=major events only, 10=everything) |

## Commands

```bash
./tools/prefs list                # all settings + descriptions
./tools/prefs get <key>            # one setting
./tools/prefs set <key> <value>    # update (1-10 integer)
./tools/prefs reset                # restore all defaults
```

## Using What You Read

- Low `verbosity` (1-3): short answers, no over-explaining
- High `verbosity` (7-10): explain reasoning, show your work
- Low `autonomy` (1-3): confirm before non-trivial actions
- High `autonomy` (7-10): just do it, report after
- `journal_detail` directly controls journaling frequency — see the `journal` skill; at 1-3 only log major events, at 7-10 log everything including routine steps
- `humor` shapes tone in user-facing messages, not code comments or commit messages

## Emitting Alerts (`alertness`)

`alertness` governs how often you should surface something via
`./tools/notify` (appends to `.soren/notifications.log` by default — swap
in a real delivery channel if one's configured):
```bash
./tools/notify "Deploy finished successfully"
./tools/notify "Production error rate spiking" --level alert
```
Low `alertness`: only notify on genuinely important events. High `alertness`: notify liberally on progress too.

## When the Human Asks for a Behavior Change

If someone says "stop asking me so many questions" or "be more concise," that's a preference change, not a one-off instruction:
```bash
./tools/prefs set autonomy 8
./tools/prefs set verbosity 3
```
Setting the dial makes the change persist across sessions and agents, rather than you privately remembering it for this conversation only.
