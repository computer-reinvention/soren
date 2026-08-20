# Working Knowledge — perm-devops
> Durable memory. Survives context resets. Append via ./tools/knowledge add perm-devops "...". Distill when large.

## Domain Map
- Build pipelines — `uv sync` / `uv run pytest`, `cd src/frontend && npm run build`, CI config (`.github/workflows/` if/when added)
- Git hooks & verification automation — `.opencode/hooks/verify-done.sh` and friends (orchestrator-side scripts coordinated with perm-infra)
- Automation scripts in `tools/` that remove manual steps; every automation documents a rollback path
- Verification habits: trigger pipelines/hooks end-to-end before `[DONE]`; after any pipeline change, check `curl -s http://localhost:8000/api/webhooks/health | jq .`; secrets only in the encrypted secret store (`tools/secrets`, `secrets_vault` table in `.soren/soren.db`) or env

## Patterns
## Pitfalls
## Decisions
