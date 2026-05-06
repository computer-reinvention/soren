# Platform Team

A team that provides infrastructure and platform capabilities to other teams.

## When to Use

- Infrastructure changes (CI/CD, deployment, monitoring)
- Shared services used by multiple features
- DevOps and reliability work
- When other teams need to "request" platform capabilities

## Org Chart

```
         ┌─────────────┐
         │Platform Lead│ ← Owns platform roadmap
         └──────┬──────┘
                │
         ┌──────┴──────┐
         │             │
    ┌────▼────┐  ┌─────▼─────┐
    │  Infra  │  │  DevOps   │
    │ Worker  │  │  Worker   │
    └─────────┘  └───────────┘
```

## Roles

| Role | Responsibility | Role Template |
|------|----------------|---------------|
| Platform Lead | Prioritizes requests, coordinates work, owns reliability | `docs/templates/roles/PLATFORM_LEAD.md` |
| Infra Worker | Servers, databases, networking, cloud resources | `docs/templates/roles/INFRA_WORKER.md` |
| DevOps Worker | CI/CD, deployments, monitoring, automation | `docs/templates/roles/DEVOPS_WORKER.md` |

## Communication Graph

```
    External Requesters (other teams, supervisor)
                │
                │ (requests)
                ▼
         Platform Lead
            ▲     ▲
            │     │
    ┌───────┘     └───────┐
    ▼                     ▼
Infra Worker ◄────► DevOps Worker
           (coordinate)
```

**Request flow**: All requests go through Platform Lead. Platform Lead triages and assigns.

## Request Protocol

### Requesting Platform Work
```bash
# Other teams request via Platform Lead
./tools/mailbox send platform-lead "Request: New Database" "
Need: PostgreSQL instance for auth service
Specs: 10GB, 2 CPU, managed backups
Priority: High (blocks auth feature)
Requester: squad-auth-lead
"
```

### Platform Lead Responds
```bash
./tools/mailbox send squad-auth-lead "Database Request Accepted" "
ETA: 2 hours
Infra worker assigned
Will notify when ready with connection string
"
```

### Completion Notification
```bash
./tools/mailbox send squad-auth-lead "Database Ready" "
Host: db.internal:5432
Database: auth_prod
Credentials: See secrets manager
Monitoring: Grafana dashboard added
"
```

## Decision Authority

| Decision Type | Who Decides |
|---------------|-------------|
| Request prioritization | Platform Lead |
| Technical implementation | Infra/DevOps workers |
| Security requirements | Platform Lead (consult security) |
| Cost decisions | Platform Lead → Supervisor for approval |

## Spawning Commands

```bash
# Supervisor spawns platform team
./tools/workers spawn "platform-lead" "Read docs/templates/roles/PLATFORM_LEAD.md. You own infrastructure and DevOps. Spawn workers for specific tasks."

# Platform lead spawns workers
./tools/workers spawn "infra-db" "Read docs/templates/roles/INFRA_WORKER.md. Your task: Provision PostgreSQL for auth service."
./tools/workers spawn "devops-ci" "Read docs/templates/roles/DEVOPS_WORKER.md. Your task: Set up CI pipeline for new repo."
```

## When NOT to Use

- Feature development (use Squad or Feature Team)
- One-off scripts (use solo worker)
- Design decisions (use Debate)
