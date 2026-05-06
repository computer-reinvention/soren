---
name: teams
description: Set up, manage, and tear down multi-agent team structures from templates. Use when you need to spawn a coordinated team (squad, feature team, platform team, tiger team, or debate pair) rather than individual workers.
allowed-tools: Bash(./tools/teams:*)
---

# Team Management

Use the `teams` tool to spawn coordinated team structures from templates. This automates the boilerplate of spawning multiple workers with correct role templates, cross-references, and naming conventions.

**When to use `teams` vs `workers`:**
- Use `teams setup` when you need a coordinated group (2+ workers with defined roles)
- Use `workers spawn` when you need a single worker for a focused task

## Commands

### Set up a team from a template
```bash
./tools/teams setup <TEMPLATE> "<task description>" [--name <prefix>] [--project <id>]
```

The `--name` prefix is used for worker naming (e.g., `auth-squad-lead`, `auth-backend`). If omitted, a prefix is auto-generated from the task.

### List available templates
```bash
./tools/teams templates
```

### List active teams
```bash
./tools/teams list
```

### Check team status (terminal output for all members)
```bash
./tools/teams status <prefix> [lines]
```

### Tear down a team (kill all members)
```bash
./tools/teams teardown <prefix>
```

## Templates

| Template | Workers | Use Case |
|----------|---------|----------|
| `SOLO_WORKER` | 1 | Simple, focused tasks |
| `SQUAD_MODEL` | 4 (lead + backend + frontend + tester) | Medium-large features |
| `FEATURE_TEAM` | 3 (tech lead + backend + frontend) | Features needing strong tech direction |
| `PLATFORM_TEAM` | 3 (platform lead + infra + devops) | Infrastructure and DevOps work |
| `TIGER_TEAM` | 3 (flat peers, no lead) | Urgent fixes, production incidents |
| `DEBATE_PAIR` | 2 (defender + critic) | Design decisions with tradeoffs |

## Examples

### Spawn a squad for a feature
```bash
./tools/teams setup SQUAD_MODEL "Implement user authentication with JWT" --name auth
# Spawns: auth-squad-lead, auth-backend, auth-frontend, auth-tester
# Then send task breakdown to the lead:
./tools/workers send "auth-squad-lead" "[TASK] Backend: JWT token creation. Frontend: login UI. Tester: end-to-end validation."
```

### Spawn a tiger team for an urgent fix
```bash
./tools/teams setup TIGER_TEAM "Fix production API 500 errors on /api/users" --name hotfix
# Spawns: hotfix-tiger-a, hotfix-tiger-b, hotfix-tiger-c
# All three coordinate directly with each other (no lead)
```

### Spawn a debate pair for a design decision
```bash
./tools/teams setup DEBATE_PAIR "Design the caching architecture" --name cache
# Spawns: cache-defender, cache-critic
# Artifacts go to .soren/journal/YYYY-MM-DD/artifacts/cache-debate/
```

### Monitor and tear down
```bash
./tools/teams status auth          # See all auth team members' terminal output
./tools/teams list                 # See all active teams
./tools/teams teardown auth        # Kill all auth team workers
```

## After Setup

The `setup` command spawns workers with correct role templates and cross-references, but uses a **generic task description**. After setup:

1. **Send specific task breakdowns** to the team lead (for hierarchical teams):
   ```bash
   ./tools/workers send "auth-squad-lead" "[TASK] Coordinate: backend builds JWT endpoints, frontend builds login UI"
   ```

2. **For flat teams** (Tiger Team), workers self-organize immediately.

3. **For debates**, the Defender writes first, then notifies the Critic.

## Best Practices

1. **Choose the right template**: Use the complexity assessment in `docs/SUPERVISOR_ROLE.md` (lines 38-106)
2. **Use descriptive prefixes**: `auth`, `cache`, `hotfix-api` — not `team1`
3. **Check templates first**: Read `docs/templates/teams/` for detailed workflow descriptions
4. **Monitor progress**: `teams status <prefix>` or `workers status <member>`
5. **Clean up**: `teams teardown <prefix>` when work is complete
