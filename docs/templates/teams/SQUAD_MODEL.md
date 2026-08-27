# Squad Model (Cross-Functional Team)

A self-contained team with all skills needed to deliver a feature end-to-end.

## When to Use

- Medium-to-large features requiring frontend + backend + testing
- Work that benefits from tight collaboration
- When you want parallel development with coordination
- Standard feature development workflow

## Org Chart

```
            ┌─────────────┐
            │ Squad Lead  │ ← Reports to main supervisor
            │ (supervisor)│
            └──────┬──────┘
                   │
    ┌──────────┬───┴───┬──────────┐
    │          │       │          │
┌───▼───┐ ┌───▼───┐ ┌──▼──┐ ┌────▼─────┐
│Backend│ │Front- │ │Test-│ │Researcher│
│Worker │ │end    │ │er   │ │          │
└───────┘ └───────┘ └─────┘ └──────────┘
```

## Roles

| Role | Reports To | Role Template |
|------|------------|---------------|
| Squad Lead | Main Supervisor | `docs/templates/roles/SQUAD_LEAD.md` |
| Backend | Squad Lead | `docs/templates/roles/FEATURE_BACKEND.md` |
| Frontend | Squad Lead | `docs/templates/roles/FEATURE_FRONTEND.md` |
| Tester | Squad Lead | `docs/templates/roles/TESTER.md` |
| Researcher | Squad Lead | `docs/templates/roles/RESEARCHER.md` |

## Communication Graph

```
                    Main Supervisor
                          ▲
                          │ (status, completion)
                          │
                    Squad Lead
               ▲    ▲    ▲    ▲
  (tasks,      │    │    │    │      (tasks,
   reviews)────┘    │    │    └────── reviews)
                    │    │
    Backend ◄──────►│    │◄────────► Frontend
          (coord)   │    │  (coord)
                    │    │
                Tester  Researcher
           (from both)  (shares findings)
```

**Who can message who:**
- Squad Lead ↔ All workers (bidirectional)
- Backend ↔ Frontend (peer coordination)
- Backend → Tester (notify when ready)
- Frontend → Tester (notify when ready)
- Tester → Backend/Frontend (bug reports)
- Researcher → All workers (share findings and recommendations)
- All workers → Researcher (ask questions, request investigation)
- Squad Lead → Main Supervisor (status, completion)

## Decision Authority

| Decision Type | Who Decides |
|---------------|-------------|
| Task assignment | Squad Lead |
| Technical approach | Worker (with Lead approval for major changes) |
| API contracts | Backend + Frontend agree, Lead approves |
| Done/ship decision | Squad Lead after Tester approval |
| Scope changes | Escalate to Main Supervisor |

## Handoff Protocols

### Backend → Frontend
```bash
# Backend notifies Frontend when API is ready
./tools/mailbox send worker-frontend-XXXX "API Ready" "
Endpoint: POST /api/feature
Request: {field1: string, field2: number}
Response: {id: string, created: timestamp}
Errors: 400 validation, 401 auth, 500 server
"
```

### Backend/Frontend → Tester
```bash
# Notify tester when ready for testing
./tools/mailbox send worker-tester-XXXX "Ready for Testing" "
Backend: API endpoints complete
Frontend: UI components complete
Test focus: [specific areas]
"
```

### Tester → Squad Lead
```bash
# Report test results
./tools/mailbox send squad-lead "Test Results" "
Passed: 12 tests
Failed: 0
Browser verified: login flow, dashboard
Evidence: .soren/journal/teams/<prefix>/.../attachments/
"
```

### Squad Lead → Main Supervisor
```bash
./tools/mailbox done "Feature X complete. Backend API, Frontend UI, all tests passing. Evidence at [path]. Commit: <sha>"
```

## Spawning Commands

```bash
# Main supervisor spawns squad
./tools/workers spawn "squad-lead" "Read docs/templates/roles/SQUAD_LEAD.md. Your task: [FEATURE]. Spawn backend, frontend, tester, researcher workers."

# Squad lead spawns team
./tools/workers spawn "backend-XXXX" "Read docs/templates/roles/FEATURE_BACKEND.md. Your task: [BACKEND SCOPE]"
./tools/workers spawn "frontend-XXXX" "Read docs/templates/roles/FEATURE_FRONTEND.md. Your task: [FRONTEND SCOPE]. Wait for API contract from backend."
./tools/workers spawn "tester-XXXX" "Read docs/templates/roles/TESTER.md. Your task: Test [FEATURE] when backend and frontend signal ready."
./tools/workers spawn "researcher-XXXX" "Read docs/templates/roles/RESEARCHER.md. Your task: Research [TOPIC] and produce a report for the team."
```

## Cross-Team Coordination (Frontend + Backend)

When a squad spans both frontend and backend components (the common case):

1. **Backend and Frontend workers must agree on API contracts before parallel development begins.** The Squad Lead facilitates this — typically by having Backend propose the contract and Frontend ACK or counter-propose.
2. **Contract-first development**: Backend publishes endpoint URLs, request/response shapes, error formats, and auth requirements. Frontend builds against the confirmed contract.
3. **Mid-sprint contract changes**: If either side discovers the contract needs to change, they notify the Squad Lead immediately. The Lead pauses affected work and re-coordinates before workers continue.
4. **Cross-project squads**: If the frontend and backend live in separate projects with their own supervisors (e.g. `sup-todo-frontend` and `sup-todo-backend`), the Squad Lead must coordinate with the sibling project's supervisor via `./tools/mailbox send sup-<project> '<subject>' '<body>'` to agree on shared interfaces before workers start.

## Workflow Phases

1. **Kickoff**: Squad Lead receives task, plans breakdown
2. **Parallel Dev**: Backend + Frontend work simultaneously
3. **Integration**: Frontend integrates with Backend API
4. **Testing Gate (MANDATORY)**: Tester validates end-to-end — NO merge without passing
5. **Review**: Squad Lead reviews all outputs AND testing evidence
6. **Completion**: Squad Lead reports to Main Supervisor with testing evidence

### Testing Gate Requirements

The squad CANNOT report `[DONE]` until ALL of the following are verified:

| Component | Required Verification |
|-----------|----------------------|
| Backend | pytest passes AND endpoints respond correctly to curl |
| Frontend | Browser test via chrome-devtools MCP (snapshot + screenshot evidence) |
| Integration | End-to-end flow tested in the browser |

**Squad Lead**: Do NOT approve completion without testing evidence from the Tester. If the Tester reports issues, send workers back to fix before reporting [DONE].

**Tester**: Your `[DONE]` message MUST include screenshot paths and test output. See `docs/templates/roles/TESTER.md` for chrome-devtools MCP and CLI testing protocols.
