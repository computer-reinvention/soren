---
name: projects
description: Manage the project registry for multi-project support. Use when you need to register, list, or manage external projects.
---

# Project Registry

Use the `projects` tool to manage the SOREN project registry. Projects registered here can have their own supervisors and workers.

## Commands

### Register a new project
```bash
./tools/projects add /path/to/project --name "Project Name" --description "What it does"
```

### List all registered projects
```bash
./tools/projects list
```

### Show project details
```bash
./tools/projects info <project-id>
```

### Activate a project
```bash
./tools/projects activate <project-id>
```

### Deactivate a project
```bash
./tools/projects deactivate <project-id>
```

### Remove a project
```bash
./tools/projects remove <project-id>
```

### Regenerate conventions skills
```bash
./tools/projects sync-skills
```

## Auto-Detection

When registering a project with `add`, the tool automatically detects:
- **Git remote** from the `origin` remote URL
- **Language** from manifest files (pyproject.toml, package.json, Cargo.toml, go.mod)
- **Project ID** from the directory basename (lowercased, sanitized)

## Conventions Skills (auto-generated)

Registering a project also generates a conventions skill at `.opencode/skills/project-<id>-conventions/SKILL.md` — the project's stack, key commands, its own rules file (AGENTS.md/CLAUDE.md excerpt), and commit style. **Load it before working on that project** (`skill({name: "project-<id>-conventions"})`). It is removed on `projects remove`; run `sync-skills` to refresh all of them after a project's rules or scripts change.

## Examples

```bash
# Register an external API project
./tools/projects add ~/code/my-api --name "My API" --description "REST API service"

# List all projects
./tools/projects list

# Get details for a specific project
./tools/projects info my-api

# Activate to enable supervisor
./tools/projects activate my-api

# Deactivate when done
./tools/projects deactivate my-api

# Remove from registry
./tools/projects remove my-api
```
