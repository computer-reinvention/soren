# Tiger Team (Urgent Fixes)

A flat, autonomous team for urgent issues requiring fast response.

## When to Use

- Production incidents
- Critical bugs blocking users
- Time-sensitive fixes
- When speed matters more than process

## Org Chart

```
         ┌─────────────────────────────┐
         │         FLAT TEAM           │
         │                             │
         │  ┌───────┐    ┌───────┐    │
         │  │Member │◄──►│Member │    │
         │  │   A   │    │   B   │    │
         │  └───┬───┘    └───┬───┘    │
         │      │            │        │
         │      └─────┬──────┘        │
         │            │               │
         │       ┌────▼────┐          │
         │       │ Member  │          │
         │       │    C    │          │
         │       └─────────┘          │
         └─────────────────────────────┘
                      │
                      ▼
              Main Supervisor
            (status updates only)
```

**NO LEAD. All members are peers with equal authority.**

## Roles

| Role | Responsibility |
|------|----------------|
| All Members | Investigate, fix, communicate, decide |

## Communication Graph

```
    Member A ◄────────► Member B
        ▲                   ▲
        │                   │
        └───────┬───────────┘
                │
                ▼
            Member C
                │
                ▼
         Main Supervisor
         (periodic updates)
```

**Everyone can message everyone directly. No bottlenecks.**

## Decision Authority

| Decision Type | Who Decides |
|---------------|-------------|
| Investigation approach | Whoever starts investigating |
| Fix approach | First reasonable proposal wins |
| Ship decision | Any member can ship if confident |
| Escalation | Any member can escalate |

## Ground Rules

1. **Act fast**: Don't wait for approval
2. **Communicate loudly**: Post to shared channel frequently
3. **Claim areas**: "I'm looking at the database" → others look elsewhere
4. **No blame**: Fix first, postmortem later
5. **Update supervisor**: Every 15 minutes with status

## Communication Protocol

### Claiming Investigation Area
```bash
./tools/mailbox send tiger-member-b "CLAIM: Database" "I'm investigating DB connection pool. Look elsewhere."
```

### Sharing Findings
```bash
./tools/mailbox send tiger-member-a "FOUND: Root cause" "
Connection pool exhausted due to leaked connections in auth flow.
Line: src/server/services/auth.py:142
Fix: Add connection.close() in finally block
I'll fix unless you have better approach.
"
```

### Status to Supervisor
```bash
./tools/mailbox send supervisor "TIGER STATUS 15:30" "
Issue: API 500 errors
Root cause: Found - connection leak
Fix: In progress (member-a)
ETA: 10 minutes
"
```

## Spawning Commands

```bash
# Supervisor spawns tiger team (no lead)
./tools/workers spawn "tiger-a" "URGENT: [ISSUE]. You are Tiger Team. Read docs/templates/teams/TIGER_TEAM.md. No lead - coordinate with tiger-b, tiger-c directly. Fix fast."
./tools/workers spawn "tiger-b" "URGENT: [ISSUE]. You are Tiger Team. Read docs/templates/teams/TIGER_TEAM.md. Coordinate with tiger-a, tiger-c. Fix fast."
./tools/workers spawn "tiger-c" "URGENT: [ISSUE]. You are Tiger Team. Read docs/templates/teams/TIGER_TEAM.md. Coordinate with tiger-a, tiger-b. Fix fast."
```

## When NOT to Use

- Non-urgent work (use Squad)
- Design decisions (use Debate)
- Large features (use Feature Team)
