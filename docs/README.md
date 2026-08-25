# SOREN Documentation

Welcome to the SOREN documentation. Choose where to start based on your goal.

## Getting Started

| Document                           | Description                       | Time   |
| ---------------------------------- | --------------------------------- | ------ |
| **[Quick Start](./QUICKSTART.md)** | Install and run SOREN in 5 minutes | 5 min  |
| **[User Guide](./USER_GUIDE.md)**  | Complete guide to using SOREN      | 20 min |
| **[Concepts](./CONCEPTS.md)**      | Deep dive into how SOREN works     | 15 min |
| **[Frontend](./FRONTEND.md)**      | Dashboard design system, component patterns, testing, dev workflow | 15 min |

## For Agents

| Document                                                    | Description                              |
| ----------------------------------------------------------- | ---------------------------------------- |
| **[Supervisor Role](./SUPERVISOR_ROLE.md)**                 | Guide for the main supervisor agent      |
| **[Feature Supervisor](./templates/FEATURE_SUPERVISOR.md)** | Template for feature session supervisors |
| **[Self-Improvement Guide](./SELF_IMPROVEMENT_GUIDE.md)**   | Guidelines for modifying SOREN safely     |

## Quick Links

- **Dashboard**: http://localhost:8000 (when running)
- **Health Check**: `curl http://localhost:8000/api/webhooks/health`
- **System Status**: `./src/orchestrator/soren.sh status`

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────────────┐
│                         SOREN System                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Orchestration (bash/tmux)                                     │
│   ├── soren.sh        Start/stop the system                      │
│   ├── monitor.sh     Master orchestrator + auto-recover           │
│   └── router.sh      Route messages between agents              │
│                                                                 │
│   Server (Python/FastAPI)                                       │
│   ├── Agent management and lifecycle                            │
│   ├── Session management                                        │
│   ├── Journal (persistent memory)                               │
│   └── WebSocket (real-time updates)                             │
│                                                                 │
│   Frontend (React)                                              │
│   ├── Explorer (agents + files)                                 │
│   ├── Chat panel (interact with agents)                         │
│   └── Activity timeline (live events)                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## The Self-Improvement Model

SOREN can safely modify itself:

1. Agents make changes to the codebase
2. Health monitor checks if everything still works
3. If broken: auto-rollback to last healthy state
4. Agents are notified and can retry with lessons learned

This enables experimentation without fear of permanent breakage.

## Document Map

```
docs/
├── README.md                    # This file (documentation index)
├── QUICKSTART.md                # 5-minute getting started
├── USER_GUIDE.md                # Complete user guide
├── CONCEPTS.md                  # Core concepts explained
├── SUPERVISOR_ROLE.md           # Main supervisor agent guide
├── SELF_IMPROVEMENT_GUIDE.md    # Safe modification guidelines
└── templates/
    └── FEATURE_SUPERVISOR.md    # Feature session supervisor template
```
