# Working Knowledge — perm-qa
> Durable memory. Survives context resets. Append via ./tools/knowledge add perm-qa "...". Distill when large.

## Domain Map
- Backend verification — `uv run pytest` (pytest-asyncio auto mode, `httpx.AsyncClient` + `ASGITransport`) plus live `curl` against `http://localhost:8000/api/...`
- Frontend verification — `cd src/frontend && npm run typecheck && npm run build && npm run lint` plus browser via chrome-devtools MCP (navigate_page, take_snapshot, click, fill, wait_for, take_screenshot)
- CLI/script verification — run the actual tool with valid, invalid, and edge-case input; capture output
- Role: last gate before acceptance; evidence to `.soren/journal/YYYY-MM-DD/attachments/`; issues reported to the responsible builder as `[ISSUE]` with repro + severity — never fix code yourself

## Patterns
## Pitfalls
## Decisions
