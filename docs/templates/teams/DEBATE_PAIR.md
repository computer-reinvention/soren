# Debate Pair Team Template

Use this template when you need to evaluate tradeoffs, make design decisions, or refine proposals through structured argument.

## When to Use

- Design decisions with multiple valid approaches
- Architecture choices that need vetting
- Evaluating competing implementation strategies
- Any task where "should we do X or Y?" is unclear

## Team Composition

| Role | Template | Purpose |
|------|----------|---------|
| Defender | `docs/templates/roles/DEBATE_DEFENDER.md` | Proposes and advocates |
| Critic | `docs/templates/roles/DEBATE_CRITIC.md` | Critiques and improves |

## Spawning Commands

```bash
# Spawn defender
./tools/workers spawn "defender" "Read docs/templates/roles/DEBATE_DEFENDER.md for your role. Your task: [TASK DESCRIPTION]. Write proposal to [OUTPUT PATH]."

# Spawn critic
./tools/workers spawn "critic" "Read docs/templates/roles/DEBATE_CRITIC.md for your role. Wait for defender's proposal at [PATH], then critique."
```

## Expected Artifacts

```
.soren/journal/YYYY-MM-DD/attachments/
├── 01-defender-proposal.md
├── 02-critic-critique.md
├── 03-defender-rebuttal.md
├── 04-critic-round2.md (if needed)
└── final-plan.md
```

## Workflow

```
Round 1:
  Defender → writes proposal → notifies Critic
  Critic → reads, critiques → notifies Defender

Round 2:
  Defender → responds to critique → notifies Critic
  Critic → reviews response → signals convergence OR continues

Final:
  Defender → writes consolidated plan
  Both → confirm completion to Supervisor
```

## Communication Protocol

### Defender notifying Critic
```bash
./tools/mailbox send critic "Proposal Ready" "See .soren/journal/YYYY-MM-DD/attachments/01-defender-proposal.md"
```

### Critic notifying Defender
```bash
./tools/mailbox send defender "Critique Ready" "ACCEPT 3, REVISE 4, REJECT 2. See 02-critic-critique.md"
```

### Both reporting completion
```bash
# Debates produce a plan artifact, not a commit — use the no-op marker
./tools/mailbox done "no-op: debate complete. Final plan at [PATH]. Defender and Critic converged."
```

## Success Criteria

- [ ] Proposal grounded in actual codebase
- [ ] Critique found substantive issues
- [ ] Revisions improved the proposal
- [ ] Both parties reached convergence
- [ ] Final plan is actionable

## When NOT to Use

- Simple tasks with obvious solutions (use solo worker)
- Urgent fixes (use Tiger Team)
- Implementation tasks (debates are for design, not coding)
