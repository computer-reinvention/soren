# Role Templates

This directory contains role templates that define agent behavior, mindset, and communication protocols.

## Quick Reference

| Role | Purpose | Used In |
|------|---------|---------|
| [DEBATE_DEFENDER](DEBATE_DEFENDER.md) | Proposes and advocates in debates | Debate Pair, Debate→Impl |
| [DEBATE_CRITIC](DEBATE_CRITIC.md) | Critiques and improves proposals | Debate Pair, Debate→Impl |
| [SQUAD_LEAD](SQUAD_LEAD.md) | Coordinates cross-functional team | Squad Model |
| [TECH_LEAD](TECH_LEAD.md) | Makes technical decisions | Feature Team |
| [PLATFORM_LEAD](PLATFORM_LEAD.md) | Manages infrastructure requests | Platform Team |
| [FEATURE_BACKEND](FEATURE_BACKEND.md) | Implements server-side code | Squad, Feature Team |
| [FEATURE_FRONTEND](FEATURE_FRONTEND.md) | Implements UI components | Squad, Feature Team |
| [INFRA_WORKER](INFRA_WORKER.md) | Provisions infrastructure | Platform Team |
| [DEVOPS_WORKER](DEVOPS_WORKER.md) | Builds CI/CD and automation | Platform Team |
| [TESTER](TESTER.md) | Validates implementations | Squad, Feature Team |
| [REVIEWER](REVIEWER.md) | Reviews decisions for workers | Any (short-lived) |

## How to Use

When spawning a worker, point them to the relevant role template:

```bash
./tools/workers spawn "backend-auth" "Read docs/templates/roles/FEATURE_BACKEND.md. Your task: [TASK]"
```

The template gives the agent:
- **Mindset**: How to think about their work
- **Workflow**: Step-by-step process to follow
- **Communication**: How to report status and completion
- **Guidelines**: Best practices and what NOT to do

## Role Template Structure

Each template follows this structure:

```markdown
# Role Name

You are a **ROLE** on a [team type]. Your job is to [purpose].

## Your Mindset
- Key mental models for this role

## Your Responsibilities
1. Primary duties
2. ...

## Your Workflow
### When You Receive a Task
1. Steps to follow
2. ...

## Communication
### With [Party]
- Example mailbox commands

## Output Expectations
- What to include in [DONE] messages

## What NOT To Do
- Common mistakes to avoid
```

## Creating New Roles

When creating a new role template:

1. Copy an existing template as a starting point
2. Define the mindset clearly
3. Specify the workflow step by step
4. Include concrete communication examples
5. Document expected outputs
6. List what NOT to do

Place the file in this directory as `ROLE_NAME.md`.
