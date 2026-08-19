---
name: contract
description: Validate, inspect, and compile permanent-team role contracts — the YAML frontmatter (tier, domains, worktree_required, protected_paths, done_requires_commit, skills) on templates/team/*-role.md. Use when editing role frontmatter, running contract validate/show/list/compile, or debugging why team up, the soren-bridge plugin, or verify-done enforced a rule.
---

# Role Contracts - Machine-Readable Role Policy

Each `templates/team/<agent_id>-role.md` opens with YAML frontmatter that is the agent's **contract**: identity, model tier, worktree policy, protected-path policy, and report format. `tools/contract` parses, validates, and compiles them. The compiled artifact `.soren/run/contracts.json` is the **runtime source of truth** consumed by `soren.sh team up`, the soren-bridge plugin, and the verify-done hook.

**Editing a contract = changing runtime behavior.** The template file itself is inert at runtime — enforcement reads `contracts.json`. After any frontmatter change, run `tools/contract compile` (or the change silently does nothing until the next `team up`, which recompiles).

## Commands

```bash
./tools/contract validate all                              # Validate every role file
./tools/contract validate templates/team/perm-qa-role.md   # Validate one file
./tools/contract show perm-backend                          # Parsed contract as JSON
./tools/contract list                                       # Table of all contracts
./tools/contract compile                                    # Write .soren/run/contracts.json
```

`validate all` also warns (never fails) when `contracts.json` is **stale** — older than any role template. That warning means runtime policy no longer matches the templates: run `tools/contract compile`.

## Schema — Field by Field

Each field lists **where it is enforced**. "Validated at spawn" = checked by `contract validate` / `team up`; "runtime-enforced" = read from `contracts.json` while agents run.

| Field | Values | Enforcement |
|-------|--------|-------------|
| `agent_id` | must match filename `<agent_id>-role.md` | validate-time only |
| `display_name` | non-empty string | validate-time only (informational) |
| `category` | `builder` \| `reviewer` \| `support` | validate-time; cross-checked against `report.verdicts` |
| `tier` | `haiku` \| `sonnet` \| `opus` | **spawn-time**: `soren.sh team up` reads `contracts.json` and passes the tier to `workers spawn --model` (soren.sh:282-289). Tier→provider model mapping happens in `tools/lib/opencode.sh` (`SOREN_MODEL_*` overrides). Not enforced after spawn. |
| `domains` | list of strings | compiled into `contracts.json`; informational routing metadata, no enforcement |
| `skills` | optional list, lowercase-hyphen names | validate-time: each entry must have `.opencode/skills/<name>/SKILL.md` on disk |
| `worktree_required` | boolean | **spawn-time**: `team up` adds `--worktree` to `workers spawn` when true. Not re-checked at runtime. |
| `protected_paths` | `forbidden` \| `via-worktree` | **runtime-enforced** by `.opencode/plugins/soren-bridge.ts`. See below — this is the strongest rule. |
| `report.format` | non-empty string | documentation of the expected `[DONE]` line; not machine-enforced as a format |
| `report.done_requires_commit` | boolean | **runtime-enforced** by `.opencode/hooks/verify-done.sh`: `false` means a commit-less `[DONE]` is auto-verified as contract-exempt instead of triggering a `[FIX-REQUEST]` retry cycle |
| `report.verdicts` | list | validate-time: reviewers must declare non-empty verdicts (e.g. `[APPROVE, REVISE, BLOCK]`); builders/support must have `[]` |
| `journal_required`, `max_tasks_before_reset` | — | present in templates but **not validated and not compiled** — aspirational today |

The body must also contain a `## Accumulated Knowledge` section (verify-done appends dated lessons there in the spawned copy).

### protected_paths — the precise semantics

The plugin's uniform policy already blocks *everyone* from editing recovery-critical paths (`src/orchestrator/`, `.opencode/plugins/`, `.opencode/hooks/`, `tools/lib/opencode.sh`, `soren.sh`) in the **live checkout** — worktree copies are normally allowed.

The contract changes that:

- `forbidden` — the agent may not touch protected paths **even inside its own worktree**. The plugin loads `contracts.json` (mtime-cached) and throws on edit/write/patch and on write-shaped bash commands (soren-bridge.ts:264-330).
- `via-worktree` — keeps the uniform policy: protected paths editable only through a worktree, merged by the supervisor after review.

A missing or unparseable `contracts.json` **fails open**: the plugin falls back to the uniform policy, and verify-done falls back to requiring commits. So a forgotten `compile` weakens enforcement — another reason to recompile immediately.

## What Consumes contracts.json

- `soren.sh team up` — validates, recompiles, then spawns with `--model <tier>` and `--worktree` per contract
- `.opencode/plugins/soren-bridge.ts` — `protected_paths: forbidden` blocking (reloads on file mtime change, so `compile` takes effect immediately for running agents)
- `.opencode/hooks/verify-done.sh` — `done_requires_commit: false` exemption

## Tips

- **Always `validate all` before `compile`** — compile hard-fails on unparseable frontmatter but validate gives readable errors
- **Recompile after every frontmatter edit** — the staleness warning in `validate all` is your safety net, not your workflow
- **Adding a skill to a `skills:` list?** The skill directory must exist on disk or validation fails
- **Frontmatter parser is a minimal YAML subset** (no PyYAML): top-level `key: value`, one level of nested map (`report:`), inline lists `[a, b]`. Don't use anchors, multi-line strings, or block lists
