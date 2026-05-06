"""Debate protocols: strategies for how agents interact."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from debate.agents import DebateAgent, DebateRound


@dataclass
class ProtocolResult:
    """Result of running a debate protocol."""
    rounds: list[DebateRound]
    total_rounds: int
    converged: bool
    metadata: dict[str, Any] = field(default_factory=dict)


class DebateProtocol(ABC):
    """Abstract base for debate protocols."""

    @abstractmethod
    async def run(
        self,
        topic: str,
        context: str,
        agents: list[DebateAgent],
        max_rounds: int = 3,
    ) -> ProtocolResult:
        """Execute the debate protocol and return results."""
        ...


class AdversarialProtocol(DebateProtocol):
    """Classic defender-vs-critic debate.

    Round flow:
    1. Defender proposes
    2. Critic critiques
    3. Defender rebuts
    4. (Optional) Critic responds again
    """

    async def run(
        self,
        topic: str,
        context: str,
        agents: list[DebateAgent],
        max_rounds: int = 3,
    ) -> ProtocolResult:
        if len(agents) != 2:
            raise ValueError("AdversarialProtocol requires exactly 2 agents")

        defender, critic = agents
        all_rounds: list[DebateRound] = []
        round_num = 0

        for _ in range(max_rounds):
            # Defender turn
            round_num += 1
            defender_round = await defender.respond(
                topic=topic,
                context=context,
                round_number=round_num,
                opponent_rounds=[r for r in all_rounds if r.agent_role == critic.role],
            )
            all_rounds.append(defender_round)

            # Critic turn
            round_num += 1
            critic_round = await critic.respond(
                topic=topic,
                context=context,
                round_number=round_num,
                opponent_rounds=[r for r in all_rounds if r.agent_role == defender.role],
            )
            all_rounds.append(critic_round)

            # Check for convergence: all verdicts are ACCEPT
            if _all_accepted(critic_round):
                return ProtocolResult(
                    rounds=all_rounds,
                    total_rounds=round_num,
                    converged=True,
                    metadata={"convergence_reason": "all_accepted"},
                )

        return ProtocolResult(
            rounds=all_rounds,
            total_rounds=round_num,
            converged=False,
            metadata={"convergence_reason": "max_rounds_reached"},
        )


class RoundRobinProtocol(DebateProtocol):
    """N agents take turns responding to each other.

    Each agent sees all previous rounds and responds in sequence.
    """

    async def run(
        self,
        topic: str,
        context: str,
        agents: list[DebateAgent],
        max_rounds: int = 3,
    ) -> ProtocolResult:
        if len(agents) < 2:
            raise ValueError("RoundRobinProtocol requires at least 2 agents")

        all_rounds: list[DebateRound] = []
        round_num = 0

        for _ in range(max_rounds):
            for agent in agents:
                round_num += 1
                opponent_rounds = [
                    r for r in all_rounds if r.agent_role != agent.role
                ]
                agent_round = await agent.respond(
                    topic=topic,
                    context=context,
                    round_number=round_num,
                    opponent_rounds=opponent_rounds,
                )
                all_rounds.append(agent_round)

        return ProtocolResult(
            rounds=all_rounds,
            total_rounds=round_num,
            converged=False,
            metadata={"protocol": "round_robin", "agent_count": len(agents)},
        )


class PanelProtocol(DebateProtocol):
    """Multiple judges independently evaluate a proposal.

    Flow:
    1. First agent (proposer) presents
    2. All remaining agents (judges) independently evaluate
    3. Proposer responds to aggregate feedback
    """

    async def run(
        self,
        topic: str,
        context: str,
        agents: list[DebateAgent],
        max_rounds: int = 2,
    ) -> ProtocolResult:
        if len(agents) < 2:
            raise ValueError("PanelProtocol requires at least 2 agents")

        proposer = agents[0]
        judges = agents[1:]
        all_rounds: list[DebateRound] = []
        round_num = 0

        for cycle in range(max_rounds):
            # Proposer presents/rebuts
            round_num += 1
            proposal = await proposer.respond(
                topic=topic,
                context=context,
                round_number=round_num,
                opponent_rounds=[r for r in all_rounds if r.agent_role != proposer.role],
            )
            all_rounds.append(proposal)

            # Each judge evaluates independently (only sees proposer's rounds)
            proposer_rounds = [r for r in all_rounds if r.agent_role == proposer.role]
            for judge in judges:
                round_num += 1
                evaluation = await judge.respond(
                    topic=topic,
                    context=context,
                    round_number=round_num,
                    opponent_rounds=proposer_rounds,
                )
                all_rounds.append(evaluation)

            # Check convergence: all judges accepted all points
            judge_rounds_this_cycle = [
                r for r in all_rounds[-len(judges):]
            ]
            if all(_all_accepted(r) for r in judge_rounds_this_cycle):
                return ProtocolResult(
                    rounds=all_rounds,
                    total_rounds=round_num,
                    converged=True,
                    metadata={
                        "convergence_reason": "panel_unanimous",
                        "judge_count": len(judges),
                    },
                )

        return ProtocolResult(
            rounds=all_rounds,
            total_rounds=round_num,
            converged=False,
            metadata={"judge_count": len(judges)},
        )


def _all_accepted(debate_round: DebateRound) -> bool:
    """Check if all arguments in a round have ACCEPT verdict."""
    if not debate_round.arguments:
        return False
    verdicts = [a.verdict.upper() for a in debate_round.arguments if a.verdict]
    if not verdicts:
        return False  # No verdicts means no convergence signal
    return all(v == "ACCEPT" for v in verdicts)
