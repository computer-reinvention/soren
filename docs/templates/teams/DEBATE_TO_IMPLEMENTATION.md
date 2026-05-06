# Debate to Implementation Pipeline

A two-phase approach: first debate the design, then implement with the winner leading.

## When to Use

- Design decisions that need vetting before implementation
- When you want to avoid implementing the wrong thing
- Architecture choices with tradeoffs
- When the best approach is unclear

## Phase 1: Debate

```
         ┌─────────────────────────────┐
         │      DEBATE PHASE           │
         │                             │
         │  ┌──────────┐ ┌──────────┐ │
         │  │ Defender │◄►│  Critic  │ │
         │  │  (peer)  │  │  (peer)  │ │
         │  └──────────┘ └──────────┘ │
         └─────────────────────────────┘
                      │
               (convergence)
                      │
                      ▼
               Final Plan
```

**Phase 1 is flat**: Defender and Critic are peers. Neither reports to the other.

## Phase 2: Implementation

```
         ┌─────────────┐
         │ Winner Lead │ ← Defender becomes lead
         │(was Defender)│   (owns final plan)
         └──────┬──────┘
                │
    ┌───────────┼───────────┐
    │           │           │
┌───▼───┐  ┌────▼────┐  ┌───▼───┐
│Worker │  │ Worker  │  │ Critic│
│   A   │  │    B    │  │(review)│
└───────┘  └─────────┘  └───────┘
```

**Phase 2 is hierarchical**: Defender becomes Lead and spawns implementation workers. Critic optionally stays for review.

## Workflow

### Phase 1: Debate (2-3 rounds)

1. **Supervisor** spawns Defender + Critic
2. **Defender** writes proposal
3. **Critic** provides critique
4. **Defender** rebuts/revises
5. **Critic** accepts or continues
6. **Both** produce final plan
7. **Defender** notifies Supervisor: "Plan converged"

### Transition

```bash
# Supervisor promotes Defender to Lead
./tools/workers send "defender" "[PROMOTION] Debate complete. You are now Implementation Lead. Spawn workers to implement final plan."
```

### Phase 2: Implementation

1. **Lead** (was Defender) spawns workers
2. **Workers** implement per final plan
3. **Critic** (optional) reviews PRs/changes
4. **Lead** coordinates and resolves issues
5. **Lead** reports completion to Supervisor

## Roles Across Phases

| Role | Phase 1 | Phase 2 |
|------|---------|---------|
| Defender | Proposes plan | Becomes Implementation Lead |
| Critic | Critiques plan | Optional reviewer |
| Workers | Not spawned | Implement plan |

## Communication Graph

### Phase 1
```
Defender ◄────────► Critic
              │
              ▼
         Supervisor
       (status only)
```

### Phase 2
```
         Lead (was Defender)
         ▲    ▲    ▲
         │    │    │
    ┌────┘    │    └────┐
    ▼         ▼         ▼
Worker A  Worker B   Critic
                    (reviewer)
```

## Spawning Commands

### Phase 1
```bash
./tools/workers spawn "defender" "Read docs/templates/roles/DEBATE_DEFENDER.md. Design: [TOPIC]. Write plan to [PATH]."
./tools/workers spawn "critic" "Read docs/templates/roles/DEBATE_CRITIC.md. Wait for defender's plan at [PATH], then critique."
```

### Transition (after convergence)
```bash
./tools/workers send "defender" "[PROMOTE TO LEAD] Debate complete. Implement the final plan. Spawn workers as needed. Critic will review."
```

### Phase 2 (Lead spawns)
```bash
./tools/workers spawn "impl-backend" "Read final plan at [PATH]. Implement backend per spec."
./tools/workers spawn "impl-frontend" "Read final plan at [PATH]. Implement frontend per spec."
```

## Decision Authority

| Phase | Decision Type | Who Decides |
|-------|---------------|-------------|
| 1 | Plan content | Defender + Critic negotiate |
| 1 | Convergence | Critic signals acceptance |
| 2 | Task breakdown | Lead |
| 2 | Technical details | Workers within plan constraints |
| 2 | Plan deviations | Lead (consult Critic if major) |

## Expected Artifacts

```
.soren/journal/YYYY-MM-DD/attachments/
├── 01-defender-proposal.md
├── 02-critic-critique.md
├── 03-defender-rebuttal.md
├── 04-critic-round2.md (if needed)
└── final-plan.md
```

## When NOT to Use

- Simple tasks with obvious solutions (use Squad)
- Urgent fixes (use Tiger Team)
- When design is already decided (skip to implementation)
