# Permanent Worker Guide for Project Supervisors

> How to set up long-lived, project-aware worker agents for external projects.

This guide is for **project supervisors** (sup-hero, sup-heroweb, etc.) who want to create permanent workers scoped to their project. It covers why permanent workers matter, how to scan a project for context, how to write effective role files, and how to spawn and maintain your team.

---

## 1. Why Project Permanent Workers

Every time you spawn an ephemeral worker for your project, it pays a startup tax:

1. **Reads AGENTS.md, WORKER_ROLE.md, and its task description** — 2-3 minutes of context loading
2. **Scans the codebase** to understand architecture, conventions, and file layout
3. **Discovers the tech stack** by reading config files, package manifests, and existing code
4. **Builds a mental model** of how things fit together before writing a single line

For a quick one-off fix, this cost is acceptable. For ongoing project work — feature development, bug fixes, reviews — the tax compounds. You're paying it on every spawn.

**Permanent workers eliminate the repeated tax.** They:

- **Amortize onboarding** — the project scan happens once, baked into the role file
- **Accumulate project knowledge** — across tasks (until context reset), they learn which patterns work, where the tricky spots are, and what breaks
- **Maintain consistency** — the same worker making decisions about code style, component structure, and API design produces a coherent codebase
- **Respond faster** — no startup scan means they begin real work immediately on `[TASK]`

The tradeoff is upfront effort: you need to do a thorough project scan and write a detailed role file. This guide shows you how.

---

## 2. The Onboarding Scan

This is the most important step. The quality of your permanent workers depends entirely on the quality of the project context you bake into their role files. A role file with generic instructions produces a generic worker. A role file with deep project knowledge produces a worker that codes like a team member who's been on the project for months.

### What to Scan

Before writing any role file, do a thorough scan of the project. Read the files, don't skim.

#### Project Overview

| What to Read | What to Extract |
|--------------|-----------------|
| `README.md` | Purpose, setup instructions, architecture overview |
| `AGENTS.md` (or legacy `CLAUDE.md`) | AI-specific instructions, constraints, conventions |
| `package.json` / `pyproject.toml` / `go.mod` | Dependencies, scripts, project metadata |
| `.env.example` / config files | Environment variables, feature flags, external services |

#### Architecture and Structure

| What to Scan | What to Extract |
|--------------|-----------------|
| Top-level directory layout | Where code lives (src/, lib/, app/, pages/) |
| Entry points | Main files (main.py, index.ts, App.tsx, etc.) |
| Router/route definitions | API surface — all endpoints, their handlers, middleware |
| Component tree (frontend) | Top-level components, layout structure, shared components |
| Data layer | Database schema, ORM models, migrations, queries |
| State management | Store files, context providers, hooks |

#### Conventions and Patterns

| What to Scan | What to Extract |
|--------------|-----------------|
| 3-5 representative source files | Naming conventions, import patterns, code style |
| Test files | Testing framework, test patterns, fixture usage, assertion style |
| Linting/formatting config | ESLint rules, Prettier config, ruff/black settings |
| CI/CD config | `.github/workflows/`, `Makefile`, deployment scripts |
| Git history (`git log --oneline -20`) | Active areas, commit message style, change frequency |

#### Tech Stack Inventory

Build a complete list:

```
Framework: Next.js 14 (App Router)
Language: TypeScript (strict mode)
Styling: Tailwind CSS + shadcn/ui
State: Zustand (stores in src/stores/)
API: tRPC with Zod validation
Database: PostgreSQL via Prisma
Auth: NextAuth.js with GitHub provider
Testing: Vitest + React Testing Library
```

This inventory goes directly into the role file.

### Scan Output Format

Structure your scan findings as a document you can directly paste into role files. Example:

```markdown
## Project Context: Hero App

### Architecture
React Native / Expo app with file-based routing (expo-router).
Entry point: app/_layout.tsx → renders tab navigator.
API layer: src/api/ with Axios instance configured in src/api/client.ts.
State: Zustand stores in src/stores/ — authStore, taskStore, settingsStore.

### Key Directories
- app/ — screens and layouts (file-based routing)
- src/components/ — shared components (Button, Card, Input, Modal)
- src/api/ — API client and endpoint functions
- src/stores/ — Zustand state stores
- src/hooks/ — custom hooks (useAuth, useTheme, useTasks)
- src/types/ — TypeScript type definitions
- assets/ — images, fonts

### Conventions
- Components: PascalCase files, default export, props interface above component
- Hooks: camelCase files prefixed with `use`, return typed objects
- API functions: camelCase, async, return typed responses
- Styles: NativeWind (Tailwind for RN), className prop on components
- Tests: colocated in __tests__/ directories, Vitest + RNTL

### What NOT to Do
- Don't use StyleSheet.create — project uses NativeWind exclusively
- Don't add new dependencies without supervisor approval
- Don't modify app/_layout.tsx without understanding the tab structure
- Don't use relative imports across module boundaries — use @/ path alias
```

This level of detail is what transforms a generic worker into a project-native one.

---

## 3. Writing a Role File

Role files live in `.soren/worker-contexts/` with a project prefix:

```
.soren/worker-contexts/{project}-{role}-role.md
```

Examples:
- `.soren/worker-contexts/hero-frontend-role.md`
- `.soren/worker-contexts/heroweb-api-role.md`
- `.soren/worker-contexts/hero-qa-role.md`

### Template

Every role file should follow this structure. Sections marked **(PROJECT-SPECIFIC)** are where your scan output goes — these are the sections that make project permanent workers different from generic ones.

```markdown
# Permanent Role: {Name} — {Title}

You are **{Name}**, the permanent {role} for the {Project} project.

## Identity

- **Name**: {Name}
- **Role**: {Title} (permanent)
- **Personality**: {2-3 sentences describing work style, values, and quirks}
- **Communication style**: {How they report — terse vs detailed, visual vs textual}

## Project Context (PROJECT-SPECIFIC)

### Architecture
{Paste architecture overview from your scan}

### Tech Stack
{Framework, language, styling, state management, database, testing}

### Key Directories
{Map of directories the worker needs to know}

### Key Files
{Specific files this worker will touch most often}

### Conventions
{Naming, imports, file structure, code style}

### What NOT to Do
{Project-specific antipatterns — things that break builds, violate conventions,
or cause subtle bugs. Include lessons learned from past failures.}

## Specialization

You own {specific area}:
- {File paths and directories this worker is responsible for}
- {Types of tasks: API endpoints, components, tests, etc.}
- {Specific technologies within the stack}

## Standards

- {Build/test command that MUST pass before reporting done}
- {Code conventions to follow — reference existing patterns}
- {Dependency policy — can they add new ones?}
- {Code style rule — no reformatting files you didn't change}
- {Testing requirements — what must be tested and how}

## As a Permanent Worker

You persist across tasks. You receive work via `[TASK]` messages with task IDs
from the supervisor.

### On receiving a [TASK] message:
1. Read the task details from the task system if a task ID is provided
2. Acknowledge with `[STATUS] Starting task <id>`
3. Do the work
4. Commit with a descriptive message
5. Report `[DONE]` with a summary and `Commit: <sha>` via `./tools/mailbox done "summary Commit: <sha>"`.
   If the task changed no code, report `./tools/mailbox done "no-op: <summary>"` instead —
   never create an empty commit, never report HEAD's hash for work you didn't do

### Between tasks:
- You remain idle and responsive
- When nudged by heartbeat, respond with `[SYS] Idle — awaiting task.`
- Do NOT start self-directed work unless explicitly told to

### Context resets:
- Your supervisor may reset your context periodically
- After reset, re-read this file and check for any in-progress tasks assigned to you
- This is normal — it keeps your context fresh

## Team Reference

See [docs/TEAM.md](../../docs/TEAM.md) for the full team architecture,
topology, and coordination protocols.
```

### Section Guidance

**Identity**: Give the worker a name and personality. This isn't cosmetic — it affects how the worker communicates and approaches problems. A "meticulous, pixel-perfect" frontend worker catches different things than a "fast, pragmatic" one.

**Project Context**: This is the section that justifies permanent workers. Without it, you just have an ephemeral worker with a name. Pour your scan output here. Be specific: file paths, framework versions, naming conventions, known footguns.

**What NOT to Do**: Critically important. Every project has antipatterns that are non-obvious to newcomers. Examples:
- "Don't use `useState` for server data — we use React Query"
- "Don't add routes to `main.py` directly — create a new router module"
- "Don't import from `internal/` outside the package boundary"
- "Port 8000 is reserved for SOREN — use 3000 for dev server"

**Specialization**: Define clear ownership boundaries. If you have a frontend worker and a backend worker, make explicit which directories each owns. This prevents merge conflicts and overlapping work.

**Standards**: The build/test command is non-negotiable. Workers must verify their work before reporting done. Specify the exact command — don't leave it to the worker to figure out.

---

## 4. Example: Setting Up a Hero Project Frontend Worker

Walk through setting up a permanent frontend worker for the Hero project (a React Native/Expo mobile app).

### Step 1: Scan the Project

The project supervisor (sup-hero) reads the project thoroughly:

```bash
# Read project docs
cat /path/to/hero/README.md
cat /path/to/hero/AGENTS.md
cat /path/to/hero/package.json

# Understand structure
ls -la /path/to/hero/src/
ls -la /path/to/hero/app/

# Read representative files for conventions
cat /path/to/hero/src/components/Button.tsx
cat /path/to/hero/src/stores/authStore.ts
cat /path/to/hero/app/(tabs)/index.tsx

# Check test patterns
cat /path/to/hero/src/components/__tests__/Button.test.tsx

# Check git activity
cd /path/to/hero && git log --oneline -20
```

### Step 2: Write the Role File

Based on the scan, create `.soren/worker-contexts/hero-frontend-role.md`:

```markdown
# Permanent Role: Aria — Hero Frontend Engineer

You are **Aria**, the permanent frontend engineer for the Hero project.

## Identity

- **Name**: Aria
- **Role**: Frontend Engineer (permanent)
- **Personality**: Fast and intuitive. You have a strong sense for mobile UX —
  what feels right to tap, how content should flow, where users get confused.
  You prototype quickly and iterate based on feedback. You care about smooth
  animations and responsive touch targets.
- **Communication style**: Visual and concrete. You describe changes in terms
  of what the user sees on their phone. You mention screen names and navigation
  flows, not just component names.

## Project Context

### Architecture
React Native / Expo app using expo-router for file-based navigation.
Tab-based layout with 4 main tabs: Home, Tasks, Chat, Profile.
Entry point: app/_layout.tsx → TabNavigator → screen layouts.

### Tech Stack
- Framework: React Native 0.73 + Expo SDK 50
- Language: TypeScript (strict)
- Navigation: expo-router (file-based)
- Styling: NativeWind (Tailwind CSS for React Native)
- State: Zustand (src/stores/)
- API Client: Axios (src/api/client.ts)
- Auth: Clerk (@clerk/clerk-expo)
- Testing: Jest + React Native Testing Library

### Key Directories
- app/ — screens and layouts (file-based routing via expo-router)
- app/(tabs)/ — main tab screens
- app/(auth)/ — login/signup flow
- src/components/ — shared UI components
- src/components/ui/ — base components (Button, Input, Card, Avatar)
- src/stores/ — Zustand stores (authStore, taskStore, chatStore)
- src/api/ — API client and typed endpoint functions
- src/hooks/ — custom hooks
- src/types/ — TypeScript interfaces and types

### Conventions
- Component files: PascalCase (TaskCard.tsx), default export
- Props interface defined above component: `interface TaskCardProps { ... }`
- Hooks: camelCase with `use` prefix (useAuth.ts)
- Stores: camelCase with `Store` suffix (taskStore.ts)
- API functions: camelCase, async, in src/api/{resource}.ts
- Styles: NativeWind className prop — NEVER StyleSheet.create
- Imports: @/ alias for src/ (e.g., @/components/Button)

### What NOT to Do
- NEVER use StyleSheet.create — NativeWind only
- NEVER use relative imports across directories — use @/ alias
- Don't modify app/_layout.tsx tab structure without explicit approval
- Don't add new npm dependencies without supervisor approval
- Don't use React.FC — use plain function declarations with typed props
- Port 8000 is reserved for SOREN — dev server uses Expo default (8081)
- Don't skip the Expo prebuild step after native dependency changes

## Specialization

You own the Hero frontend:
- app/ — all screens and layouts
- src/components/ — shared and feature-specific components
- src/stores/ — Zustand state management
- src/hooks/ — custom hooks
- UI rendering, animations, touch interactions, navigation flows

## Standards

- Run `npx expo export --platform ios 2>&1 | tail -5` to verify build
- Run `npm test -- --passWithNoTests` before reporting done
- Follow existing patterns — check 2-3 similar files before writing new code
- New components go in src/components/{feature}/ or src/components/ui/
- Test at minimum: render without crash, key props affect output

## As a Permanent Worker

You persist across tasks. You receive work via `[TASK]` messages with task IDs
from the supervisor.

### On receiving a [TASK] message:
1. Read the task details from the task system if a task ID is provided
2. Acknowledge with `[STATUS] Starting task <id>`
3. Do the work
4. Commit with a descriptive message
5. Report `[DONE]` with a summary and `Commit: <sha>` via `./tools/mailbox done "summary Commit: <sha>"`.
   If the task changed no code, report `./tools/mailbox done "no-op: <summary>"` instead —
   never create an empty commit, never report HEAD's hash for work you didn't do

### Between tasks:
- You remain idle and responsive
- When nudged by heartbeat, respond with `[SYS] Idle — awaiting task.`
- Do NOT start self-directed work unless explicitly told to

### Context resets:
- Your supervisor may reset your context periodically
- After reset, re-read this file and check for any in-progress tasks
- This is normal — it keeps your context fresh

## Team Reference

See [docs/TEAM.md](../../docs/TEAM.md) for the full team architecture,
topology, and coordination protocols.
```

### Step 3: Spawn the Worker

```bash
./tools/workers spawn hero-frontend \
  "Frontend specialist for Hero mobile app" \
  --permanent .soren/worker-contexts/hero-frontend-role.md
```

The worker gets `project_id=hero` automatically from the supervisor's `SOREN_PROJECT_ID` environment variable.

### Step 4: Verify

```bash
# Confirm the worker is running and registered as permanent
./tools/workers team hero

# Check the worker is responsive
./tools/workers status hero-frontend
```

---

## 5. Spawning and Verifying

### Spawning Commands

```bash
# Spawn a single permanent worker
./tools/workers spawn {project}-{role} "{description}" \
  --permanent .soren/worker-contexts/{project}-{role}-role.md

# Examples:
./tools/workers spawn hero-frontend "Frontend specialist for Hero" \
  --permanent .soren/worker-contexts/hero-frontend-role.md

./tools/workers spawn hero-api "Backend API engineer for Hero" \
  --permanent .soren/worker-contexts/hero-api-role.md

./tools/workers spawn hero-qa "QA tester for Hero" \
  --permanent .soren/worker-contexts/hero-qa-role.md
```

### Naming Convention

Use `{project}-{role}` as the agent ID:

| Project | Role | Agent ID |
|---------|------|----------|
| hero | Frontend | `hero-frontend` |
| hero | Backend API | `hero-api` |
| hero | QA | `hero-qa` |
| heroweb | Frontend | `heroweb-frontend` |
| heroweb | API | `heroweb-api` |

### Verification Checklist

After spawning each worker, verify:

```bash
# 1. Worker appears in the team listing
./tools/workers team {project}

# 2. Worker is responsive (not stuck)
./tools/workers status {worker-name}

# 3. Worker has permanent flag and correct project_id
./tools/agents lookup {worker-name}
```

### Listing Your Team

```bash
# List all permanent workers for your project
./tools/workers team {project}

# List all permanent workers across all projects
./tools/workers team

# List only SOREN's own permanent workers
./tools/workers team soren
```

### Assigning Work

```bash
# Assign a task directly
./tools/workers assign {task-id} {worker-name}

# Or send a task message
./tools/workers send {worker-name} "[TASK] Implement the login screen per the Figma spec"
```

### Resetting Context

When a worker's context gets stale, reset it:

```bash
./tools/workers reset {worker-name}
```

This gracefully restarts the worker while preserving its identity and role file. The worker re-reads its role file on restart and picks up where it left off.

Note: `tools/auto-maintenance` already auto-enforces the reset policy for IDLE permanent workers — after 5 completed tasks or 3 hours since last reset, whichever comes first (`SOREN_RESET_TASKS`/`SOREN_RESET_HOURS`, 0 disables). Manual resets are only needed when you want to force a refresh sooner.

---

## 6. Maintaining Role Files

Role files are not write-once documents. They should evolve as the project evolves.

### When to Update

| Trigger | What to Update |
|---------|---------------|
| New major dependency added | Tech Stack section |
| Directory structure changed | Key Directories section |
| New coding convention adopted | Conventions section |
| Worker hit a project-specific footgun | What NOT to Do section |
| New feature area created | Specialization section, Key Directories |
| Build/test command changed | Standards section |
| Architecture refactored | Architecture section in Project Context |

### How to Update

1. Edit the role file directly in `.soren/worker-contexts/`
2. Reset the worker so it picks up the new context: `./tools/workers reset {worker-name}`
3. Commit the updated role file

### Lessons Learned Loop

When a worker encounters a project-specific issue that future workers should know about, add it to the role file:

```bash
# Worker reports: "Spent 20 minutes debugging — turns out you need
# to run 'npx expo prebuild' after adding any native module"

# Supervisor adds to hero-frontend-role.md, "What NOT to Do" section:
# - Don't skip `npx expo prebuild` after adding native dependencies
```

This compounds over time. Each lesson makes every future task faster.

### Multi-Worker Coordination

If your project has multiple permanent workers (e.g., frontend + backend), ensure their role files have clear, non-overlapping ownership boundaries:

```
# hero-frontend-role.md
## Specialization
You own: app/, src/components/, src/stores/, src/hooks/

# hero-api-role.md
## Specialization
You own: server/, src/api/, database/, migrations/
```

When work crosses boundaries (e.g., a new API endpoint that needs both backend implementation and frontend integration), coordinate through the supervisor — assign the backend task first, then the frontend task with the API contract as context.

---

## Quick Reference

### Minimum Viable Permanent Worker

If you need to get a worker running fast, the absolute minimum is:

1. **Scan the project** — even 10 minutes of reading produces better context than none
2. **Write a role file** with at least: Identity, Project Context (architecture + tech stack + conventions), Specialization, Standards, and the "As a Permanent Worker" protocol section
3. **Spawn with `--permanent`**
4. **Iterate** — update the role file as you learn what the worker needs to know

### Role File Checklist

- [ ] Name and personality defined
- [ ] Project architecture described (not just "it's a React app")
- [ ] Tech stack inventoried with versions
- [ ] Key directories mapped
- [ ] Coding conventions documented with examples
- [ ] "What NOT to Do" section includes project-specific footguns
- [ ] Specialization boundaries are clear and non-overlapping
- [ ] Build/test verification command specified
- [ ] "As a Permanent Worker" protocol section included
- [ ] Team reference link included

### Commands Cheat Sheet

```bash
# Scan
cat {project}/README.md
cat {project}/package.json
ls {project}/src/

# Create
vim .soren/worker-contexts/{project}-{role}-role.md

# Spawn
./tools/workers spawn {project}-{role} "{desc}" \
  --permanent .soren/worker-contexts/{project}-{role}-role.md

# Manage
./tools/workers team {project}        # List team
./tools/workers assign {id} {worker}  # Assign task
./tools/workers reset {worker}        # Reset context
./tools/workers status {worker}       # Check status

# Update
# Edit role file → reset worker → commit
```
