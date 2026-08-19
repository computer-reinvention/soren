---
name: worktree
description: Use when creating, inspecting, merging, or cleaning git worktrees for soren agents — the isolation mechanism for protected-path and builder work. Covers tools/worktree CLI, worktree jail (SOREN_WORKTREE), branch conventions, and the PR-flow for merging worktree branches.
---

# Soren Worktrees

Git worktrees are soren's isolation mechanism: workers that touch protected
paths (or any builder doing risky work) get their own checkout on their own
branch, so the live checkout — the running system — is never edited directly.

## Conventions

| Thing | Value |
|---|---|
| Path | `~/.soren/worktrees/<project>/<name>` |
| Branch | `feat/<name>` |
| Branch point | HEAD of the source repo at creation time (may be a supervisor's integration branch, NOT necessarily main) |
| Project | `--project <id>` > `SOREN_PROJECT_ID` > `soren` |
| Registry | `.soren/agent_registry.json` records `worktree_path` and `worktree_branch` per agent |

These conventions are shared by `tools/workers spawn <name> "<task>" --worktree`
(which creates the worktree AND a jailed worker in it) and `tools/worktree new`
(which creates just the worktree).

## The worktree jail (SOREN_WORKTREE)

Workers spawned with `--worktree` get `SOREN_WORKTREE=<path>` in their
environment. The `.opencode/plugins/soren-bridge.ts` plugin enforces the jail
on every tool call:

- **edit/write/patch** targeting the live checkout are blocked outright — the
  worker must write inside its worktree.
- **Protected paths** (`src/orchestrator/`, `.opencode/plugins/`,
  `.opencode/hooks/`, `tools/lib/opencode.sh`, `soren.sh`) can never be edited
  in the live checkout by ANY agent; worktree copies are editable, and changes
  arrive via reviewed merges.
- **Contract rule**: agents whose compiled contract
  (`.soren/run/contracts.json`) declares `protected_paths: "forbidden"` may
  not touch protected paths even inside their worktree — only
  `"via-worktree"` agents may. Role frontmatter also carries a boolean
  `worktree_required` (validated by `tools/contract`) — spawn such agents with
  `--worktree`, always.
- **Bash heuristic**: write-shaped commands (`>`, `sed -i`, `mv`, `rm`, ...)
  mentioning protected paths are blocked when they target the live checkout or
  the agent has no worktree.
- Manual override for human ops only: `SOREN_PROTECTED_OVERRIDE=1`.

## CLI reference — tools/worktree

```bash
./tools/worktree list                    # all soren worktrees: branch, dirty/clean,
                                         # ahead/behind main, owning agent
./tools/worktree new <name>              # create ~/.soren/worktrees/<project>/<name>
                                         # on feat/<name> from HEAD; refuses if exists
./tools/worktree new api-fix --project webapp --repo /path/to/repo
./tools/worktree status <name>           # uncommitted files, commits ahead of main,
                                         # last commit
./tools/worktree merge <name>            # verify clean, rebase onto main (aborts and
                                         # reports on conflict), print PR-flow commands
./tools/worktree clean <name>            # remove worktree + branch — ONLY if fully
                                         # merged into main and clean
./tools/worktree clean <name> --force    # discard unmerged/dirty work (destructive)
./tools/worktree clean --merged          # sweep all clean, fully-merged worktrees
```

Env: `SOREN_WORKTREES_DIR` overrides the worktrees root, `SOREN_PROJECT_ID`
sets the default project.

## Merge-back: the PR flow

Agents never `git checkout main` in the live checkout — the running system
lives there. Integration goes through a PR:

```bash
./tools/worktree merge <name>       # verifies clean + rebases feat/<name> onto main
git -C ~/.soren/worktrees/<project>/<name> push -u origin feat/<name>
gh pr create --head feat/<name> --base main --fill
# after the PR merges:
./tools/worktree clean <name>
```

If the rebase hits conflicts, `merge` aborts it (branch untouched) and prints
the manual resolution path. For clone workers specifically,
`./tools/workers merge-clone <clone>` handles merge + cleanup as the parent.

## Cleanup rules

- `clean` refuses dirty worktrees and branches not fully merged into main
  (`git branch --merged` check). `--force` overrides both — that deletes work.
- `./tools/workers kill` deliberately **preserves** the worktree and branch so
  unmerged work survives the worker — it prints a cleanup reminder instead.
  Orphaned worktrees after a kill are normal; sweep them after merging with
  `./tools/worktree clean --merged`.

## Common pitfalls

- **Editing the live checkout** instead of the worktree — the jail blocks
  file tools, but don't fight it with bash tricks; work in `$SOREN_WORKTREE`.
- **Branching from the wrong HEAD**: the worktree branches from the source
  repo's current HEAD. Supervisors must check out their integration branch
  *before* spawning worktree workers.
- **Orphaned worktrees**: kill preserves worktrees by design. Run
  `./tools/worktree list` periodically; clean merged ones.
- **Reusing a name**: `new` refuses an existing worktree; if only the branch
  `feat/<name>` is left over, `new` re-attaches to it (with a warning) rather
  than silently branching fresh.
- **Merging to main locally**: don't. Rebase + push + `gh pr create` — the
  live checkout stays on main untouched and the health/rollback machinery
  keeps working.
