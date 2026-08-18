---
name: gh-cli
description: GitHub CLI workflows used in this system - PRs, merges, releases, checks, and API queries. Load before any GitHub interaction.
---

# GitHub CLI (gh)

The user works PR-first: every change lands via a branch + PR, merged with a
merge commit, branch deleted. Match that.

## The standard flow (used by this repo)

```bash
git checkout -b <type>/<slug>            # fix/, feat/, chore/
git add <files> && git commit            # conventional-commit style, body explains WHY
git push -u origin <branch>
gh pr create --base main --title "..." --body "..."   # body: Summary / Fixes / Test plan
gh pr merge <n> --merge --delete-branch
git checkout main && git pull
```

Rules:
- Never merge without the test suite green. State test results in the PR body.
- PR bodies use sections: `## Summary`, findings/fixes as bullets, `## Test plan` with checkboxes.
- One concern per PR. Follow-ups get their own branch, even one-liners.
- Never force-push, never rewrite history on main (rollback targets depend on it).

## Inspection

```bash
gh pr list --state open                       # what's in flight
gh pr view <n> --json state,mergeable,statusCheckRollup
gh repo view <owner>/<repo> --json pushedAt,defaultBranchRef
gh run list --limit 5                         # CI state (if workflows exist)
gh run view <id> --log-failed                 # only the failing steps
gh search prs --author @me --state open
```

## API for anything the porcelain lacks

```bash
gh api repos/{owner}/{repo}/commits --jq '.[0].sha'
gh api user/orgs --jq '.[].login'
gh api -X POST repos/{owner}/{repo}/issues -f title="..." -f body="..."
```

`--jq` beats piping to jq (no quoting fights). Paginate with `--paginate`.

## Auth & context

- `gh auth status` before assuming anything works.
- This machine is authenticated as the repo owner; org repos live under
  `computer-reinvention`. Default repo comes from the git remote — pass
  `--repo owner/name` when operating outside the cwd repo.

## Anti-patterns

- Squash/rebase merges here — history granularity matters to the rollback system. Use `--merge`.
- `gh pr merge` without `--delete-branch` — leaves branch litter.
- Editing PR descriptions to claim tests pass without running them.
- Using raw `git push origin main` to bypass review for non-trivial changes.
