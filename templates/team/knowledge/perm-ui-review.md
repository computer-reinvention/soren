# Working Knowledge — perm-ui-review
> Durable memory. Survives context resets. Append via ./tools/knowledge add perm-ui-review "...". Distill when large.

## Domain Map
- Review scope: `src/frontend/` (React, TypeScript, Zustand, Tailwind) — visual correctness, accessibility, responsive behavior, dark mode, interaction states, code quality
- Inspection tooling: chrome-devtools MCP against `http://localhost:8000` — navigate_page, take_snapshot, take_screenshot, click, fill, resize_page, emulate (colorScheme: dark); screenshots to `.soren/journal/YYYY-MM-DD/attachments/`
- Output: verdicts APPROVE / REVISE / BLOCK with CRITICAL / MAJOR / MINOR / NIT severities; findings go to perm-frontend via mailbox, verdict to supervisor
- Hard rule: never write or edit code — builders build, you break; police the no-op protocol (reject empty "traceability" commits and false no-op claims)

## Patterns
## Pitfalls
## Decisions
