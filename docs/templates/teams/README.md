# Team Templates

This directory documents common team patterns for SOREN sessions.

## Quick Selection Guide

| Scenario | Team Template |
|----------|---------------|
| Simple bug fix | [SOLO_WORKER](SOLO_WORKER.md) |
| Feature (frontend + backend + tests) | [SQUAD_MODEL](SQUAD_MODEL.md) |
| Feature with strong tech oversight | [FEATURE_TEAM](FEATURE_TEAM.md) |
| Infrastructure/DevOps work | [PLATFORM_TEAM](PLATFORM_TEAM.md) |
| Production incident | [TIGER_TEAM](TIGER_TEAM.md) |
| Design decision with tradeoffs | [DEBATE_PAIR](DEBATE_PAIR.md) |
| Design then implement | [DEBATE_TO_IMPLEMENTATION](DEBATE_TO_IMPLEMENTATION.md) |

## Available Templates

### [SOLO_WORKER](SOLO_WORKER.md)
- **When to use:** Simple, focused tasks
- **Agents:** 1 worker
- **Example:** "Fix typo in README"

### [SQUAD_MODEL](SQUAD_MODEL.md)
- **When to use:** Medium-to-large features with frontend + backend
- **Agents:** Squad Lead, Backend, Frontend, Tester
- **Example:** "Implement user settings page"

### [FEATURE_TEAM](FEATURE_TEAM.md)
- **When to use:** Features requiring strong technical direction
- **Agents:** Supervisor, Tech Lead, Workers
- **Example:** "Build authentication system with JWT"

### [PLATFORM_TEAM](PLATFORM_TEAM.md)
- **When to use:** Infrastructure and DevOps work
- **Agents:** Platform Lead, Infra Worker, DevOps Worker
- **Example:** "Set up CI/CD pipeline"

### [TIGER_TEAM](TIGER_TEAM.md)
- **When to use:** Production incidents, urgent fixes
- **Agents:** 2-3 peers (no lead)
- **Example:** "Fix production API 500 errors"

### [DEBATE_PAIR](DEBATE_PAIR.md)
- **When to use:** Design decisions with tradeoffs
- **Agents:** Defender, Critic
- **Example:** "Design authentication system"

### [DEBATE_TO_IMPLEMENTATION](DEBATE_TO_IMPLEMENTATION.md)
- **When to use:** Debate design, then implement with the winner
- **Agents:** Defender → becomes Lead, Critic → becomes Reviewer, Workers
- **Example:** "Design and build caching layer"

## Role Templates

Individual role templates are in [../roles/](../roles/):

| Role | Template |
|------|----------|
| Debate Defender | [DEBATE_DEFENDER.md](../roles/DEBATE_DEFENDER.md) |
| Debate Critic | [DEBATE_CRITIC.md](../roles/DEBATE_CRITIC.md) |
| Squad Lead | [SQUAD_LEAD.md](../roles/SQUAD_LEAD.md) |
| Tech Lead | [TECH_LEAD.md](../roles/TECH_LEAD.md) |
| Platform Lead | [PLATFORM_LEAD.md](../roles/PLATFORM_LEAD.md) |
| Backend Worker | [FEATURE_BACKEND.md](../roles/FEATURE_BACKEND.md) |
| Frontend Worker | [FEATURE_FRONTEND.md](../roles/FEATURE_FRONTEND.md) |
| Infra Worker | [INFRA_WORKER.md](../roles/INFRA_WORKER.md) |
| DevOps Worker | [DEVOPS_WORKER.md](../roles/DEVOPS_WORKER.md) |
| Tester | [TESTER.md](../roles/TESTER.md) |
