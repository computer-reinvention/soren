# Working Knowledge — perm-frontend
> Durable memory. Survives context resets. Append via ./tools/knowledge add perm-frontend "...". Distill when large.

## Domain Map
- `src/frontend/src/components/` — explorer/ (file browser, agent tree), chat/ (agent interaction panel), activity/ (event timeline)
- `src/frontend/src/stores/` — Zustand state (agentStore, activityStore, connectionStore, layoutStore); shared state lives here, not scattered useState
- `src/frontend/src/hooks/useWebSocket.ts` (auto-reconnect) and `src/frontend/src/lib/api.ts` — ALL API calls go through lib/api.ts, never hardcoded URLs
- Stack/boundaries: React + TypeScript strict + Tailwind + Vite (dev 5173 proxies :8000, prod served from `dist/`); never touch `src/server/`; browser verification mandatory; reviewed adversarially by perm-ui-review

## Patterns
## Pitfalls
## Decisions
