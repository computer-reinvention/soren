---
name: release-engineering
description: Design CI gates, rollback-first deploys, sane versioning, and clean artifact hygiene. Load when touching CI pipelines, deploy scripts, release processes, or the health/rollback machinery.
---

# Release Engineering

The goal is boring releases: small, reversible, verified. Excitement during a deploy means the process failed earlier.

## CI Gates

- A gate is a **hard stop**, not a suggestion. Tests, typecheck, lint, build — if any fail, nothing merges/ships. "Merge now, fix CI later" converts CI into decoration.
- Order gates fastest-first (lint → typecheck → unit → integration → build) so failures cost seconds, not minutes.
- Gates must be **deterministic**: pinned dependency versions, no network flakiness in tests, no clock dependence. A gate that randomly fails gets bypassed within a week — and then it's not a gate.
- Every gate runs on a clean checkout, not a developer's warm cache. "Works on my machine" is exactly what CI exists to catch.
- In SOREN: workers run `uv run pytest` / `npm run typecheck` / `npm run build` *before* reporting `[DONE]` — that's the local gate; verify-done and reviewers are the second gate. Don't self-certify past either.

## Rollback-First Deploys

Design the undo **before** the deploy. If you can't state the rollback in one command, you're not ready to ship.

- The fastest fix for a bad deploy is almost always *rolling back*, not rolling forward with a hotfix written under pressure at 3am.
- Rollback must be: automated, tested (actually exercised, not theoretical), and safe with the current data (see migrations below).
- **Migrations gate rollbacks**: schema changes must be backward-compatible one version back (additive first: add column → dual-write → backfill → switch reads → drop later). A deploy whose migration the old code can't read has no rollback — call that out explicitly in review.
- SOREN's monitor embodies this: health check fails repeatedly → stash → roll back to last good commit → rebuild → restart. Respect it: keep main always-deployable, commit in coherent units so the rollback target is a working state.
- Small deploys roll back cleanly; 40-commit mega-deploys roll back into chaos. Ship in slices.

## Versioning

- Semver as a communication contract: **major** = breaking (callers must act), **minor** = additive (safe upgrade), **patch** = fixes. The version number is documentation for people who will never read your changelog.
- Version bumps happen in the release commit, tagged (`git tag v1.4.2`), so every artifact traces to an exact commit.
- Internal APIs between components (SOREN backend ↔ frontend) version by contract discipline instead: additive changes flow freely; breaking changes require coordinated deploys — flag them loudly in `[DONE]` reports.
- Never reuse or move a tag. Never republish a changed artifact under the same version — that breaks the one guarantee versions provide.

## Artifact Hygiene

- **Build once, promote everywhere**: the artifact you tested is the artifact you deploy. Rebuilding "the same" code for prod produces a different, untested artifact.
- Artifacts are reproducible: lockfiles committed (`uv.lock`, `package-lock.json`), build inputs pinned, no `latest` tags in dependencies.
- Generated output (dist/, build/, __pycache__) stays out of git; lockfiles stay in. The repo holds sources and recipes, the registry holds artifacts.
- Stamp artifacts with provenance: version + commit SHA + build time, exposed at runtime (health endpoint or `--version`) so "what is actually running?" has a one-command answer.
- Prune: unbounded artifact/log/worktree accumulation is a slow-motion disk-full incident. Retention is part of the pipeline.

## Checklist

1. Every pipeline change keeps gates hard, fast-first, and deterministic.
2. Every deploy has a stated, tested, one-command rollback.
3. Schema/data changes are backward-compatible one version back, or explicitly flagged as no-rollback.
4. Artifacts are versioned, traceable to a commit, built once.
5. Lockfiles updated intentionally and committed with the change that needed them.

## Anti-Patterns

- Skipping CI with `--no-verify` / force-merge "just this once".
- Hotfixing production directly instead of rolling back.
- `latest` as a deployable version.
- Deploy scripts that only work when run from one person's laptop.
- Coupling a risky migration and a big feature in one release — separate them so each can fail independently.
