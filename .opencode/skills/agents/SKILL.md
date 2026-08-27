---
name: agents
description: List and look up agents in the SOREN registry (read-only). Use to quickly check an agent's status, project, tier, or paths without querying the API or opening the dashboard.
---

# Agents - Registry Lookup

Read-only view of `.soren/agent_registry.json`. Faster than a curl round-trip when you just need to check one thing about an agent.

## Commands

```bash
./tools/agents list                    # every registered agent, one line each
./tools/agents lookup <id-or-name>      # full detail for one agent
```

`lookup` accepts either the agent's key (e.g. `trie-tech-lead`) or its `agent_id` (e.g. `ag_p4tmrhgg`).

## When to Use This vs. the API

- Quick manual check while working in a terminal → `agents lookup <name>`
- Anything programmatic, or you need live tmux/status data merged in (not just the registry snapshot) → `GET /api/agents` / `GET /api/agents/{id}` instead
- This tool reads the registry file directly — it won't reflect a status change that hasn't been written back yet

## Notes

- Read-only — there's no `agents` subcommand to register, update, or delete an entry. Registration happens through `tools/workers spawn`/`tools/teams setup`; edits happen through the normal agent lifecycle, never by hand-editing `agent_registry.json`.
