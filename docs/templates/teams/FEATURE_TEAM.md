# Feature Team with Tech Lead

A hierarchical team where a Tech Lead makes technical decisions and workers implement.

## When to Use

- Features requiring strong technical direction
- When architectural decisions need a single authority
- Complex implementations needing design oversight
- When you want technical review before merging

## Org Chart

```
         ┌─────────────┐
         │ Supervisor  │ ← Owns outcome
         └──────┬──────┘
                │
         ┌──────▼──────┐
         │  Tech Lead  │ ← Makes technical decisions
         └──────┬──────┘
                │
    ┌───────────┼───────────┐
    │           │           │
┌───▼───┐  ┌────▼────┐  ┌───▼───┐
│Worker │  │ Worker  │  │Worker │
│   A   │  │    B    │  │   C   │
└───────┘  └─────────┘  └───────┘
```

## Roles

| Role | Reports To | Role Template | Responsibility |
|------|------------|---------------|----------------|
| Supervisor | User | — | Outcome owner, delegates to Tech Lead |
| Tech Lead | Supervisor | `docs/templates/roles/TECH_LEAD.md` | Technical decisions, code review, worker coordination |
| Backend Worker | Tech Lead | `docs/templates/roles/FEATURE_BACKEND.md` | Backend implementation |
| Frontend Worker | Tech Lead | `docs/templates/roles/FEATURE_FRONTEND.md` | Frontend implementation |
| Tester | Tech Lead | `docs/templates/roles/TESTER.md` | Validation and testing |

## Communication Graph

```
    Supervisor
        ▲
        │ (progress, blockers, completion)
        │
    Tech Lead
    ▲   ▲   ▲
    │   │   │
    │   │   │ (tasks, reviews, approvals)
    ▼   ▼   ▼
Worker A  Worker B  Worker C
    └───────┴───────┘
     (no direct peer
      communication)
```

**Key difference from Squad Model**: Workers do NOT coordinate directly. All communication goes through Tech Lead.

## Decision Authority

| Decision Type | Who Decides |
|---------------|-------------|
| Task breakdown | Tech Lead |
| Technical approach | Tech Lead |
| Code approval | Tech Lead reviews all changes |
| Architecture changes | Tech Lead (may consult Supervisor) |
| Done decision | Tech Lead → Supervisor approves |

## Handoff Protocols

### Tech Lead → Workers
```bash
./tools/workers send "worker-a-XXXX" "[TASK] Implement the database schema per spec. Do not proceed to API until I review."
```

### Workers → Tech Lead
```bash
./tools/mailbox send tech-lead "Schema Complete" "
Created tables: users, sessions, tokens
Files: src/server/models/auth.py
Ready for review before proceeding.
"
```

### Tech Lead → Supervisor
```bash
./tools/mailbox send supervisor "[DONE] Auth feature complete" "
Reviewed: All worker implementations
Tests: Passing
Architecture: Clean, follows patterns
Ready for final approval.
"
```

## Spawning Commands

```bash
# Supervisor spawns tech lead
./tools/workers spawn "tech-lead" "Read docs/templates/roles/TECH_LEAD.md. Your task: [FEATURE]. You own technical decisions. Spawn workers as needed."

# Tech lead spawns workers
./tools/workers spawn "worker-backend" "Read docs/templates/roles/FEATURE_BACKEND.md. Your task: [BACKEND TASK]. Report to me when complete. Do not proceed without my review."
./tools/workers spawn "worker-frontend" "Read docs/templates/roles/FEATURE_FRONTEND.md. Your task: [FRONTEND TASK]. Wait for backend API contract."
./tools/workers spawn "worker-tester" "Read docs/templates/roles/TESTER.md. Your task: Test [FEATURE] when implementation is ready."
```

## Testing Gate Before Merge (MANDATORY)

The Tech Lead MUST NOT approve completion until all testing is verified:

### Requirements

1. **Backend workers**: pytest passes AND endpoints verified with curl
2. **Frontend workers**: Browser tested via Chrome MCP — snapshot and screenshot evidence REQUIRED
3. **All workers**: Include testing evidence in their completion reports
4. **Tech Lead**: Reviews testing evidence before approving — rejects if evidence is missing

### Tech Lead Checklist Before Reporting [DONE]

- [ ] All workers reported completion with testing evidence
- [ ] Backend tests pass (`uv run pytest`)
- [ ] Frontend verified in browser (Chrome MCP screenshots exist)
- [ ] End-to-end flow tested
- [ ] No workers reported [BLOCKED] on testing

**If any worker cannot verify their changes, the Tech Lead reports [BLOCKED] to the Supervisor — never [DONE] without complete testing evidence.**

## Cross-Team Coordination (Frontend + Backend)

When a feature team spans both frontend and backend (e.g. a full-stack feature with separate frontend and backend workers, or when a sibling project supervisor owns the other half):

1. **API contracts must be agreed before workers start coding.** The Tech Lead (or both project supervisors) must confirm endpoint URLs, request/response shapes, error formats, and auth requirements.
2. **Backend ships the contract first.** Frontend workers wait for a confirmed API contract before building against it.
3. **Breaking changes trigger re-coordination.** If a worker discovers the contract needs to change mid-implementation, they report to the Tech Lead, who re-coordinates with the other side before work continues.
4. **Cross-project teams**: If the frontend and backend live in separate projects with their own supervisors (e.g. `sup-todo-frontend` and `sup-todo-backend`), both supervisors must agree on the contract via direct mailbox messages before delegating to workers.

## When NOT to Use

- Simple tasks (use solo worker)
- When speed matters more than oversight (use Tiger Team)
- When design is unclear (use Debate first)
