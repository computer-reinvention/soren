"""Convergence detection and synthesis logic."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from debate.agents import Argument, DebateRound
from debate.llm import LLMBackend, LLMMessage
from debate.protocols import ProtocolResult


@dataclass
class SynthesisResult:
    """Final synthesis of a debate."""
    summary: str
    accepted_points: list[str]
    revised_points: list[str]
    rejected_points: list[str]
    concessions: list[str]
    final_recommendation: str
    convergence_score: float  # 0.0 to 1.0
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "summary": self.summary,
            "accepted_points": self.accepted_points,
            "revised_points": self.revised_points,
            "rejected_points": self.rejected_points,
            "concessions": self.concessions,
            "final_recommendation": self.final_recommendation,
            "convergence_score": self.convergence_score,
            "metadata": self.metadata,
        }


class SynthesisEngine:
    """Analyzes debate results and produces a synthesis."""

    def __init__(self, llm: LLMBackend | None = None):
        self.llm = llm

    def analyze_convergence(self, result: ProtocolResult) -> float:
        """Calculate convergence score (0.0 to 1.0) from debate rounds.

        Scoring:
        - ACCEPT verdicts increase score
        - REVISE verdicts are neutral
        - REJECT verdicts decrease score
        - Concessions by the defender increase score
        """
        if not result.rounds:
            return 0.0

        total_verdicts = 0
        accept_count = 0
        reject_count = 0
        total_concessions = 0

        for r in result.rounds:
            for arg in r.arguments:
                if arg.verdict:
                    total_verdicts += 1
                    v = arg.verdict.upper()
                    if v == "ACCEPT":
                        accept_count += 1
                    elif v == "REJECT":
                        reject_count += 1
            total_concessions += len(r.concessions)

        if total_verdicts == 0:
            # No verdicts — use concession count as a rough heuristic
            return min(total_concessions * 0.2, 1.0) if total_concessions else 0.5

        # Base score from verdict ratio
        score = accept_count / total_verdicts

        # Bonus for concessions (shows willingness to converge)
        concession_bonus = min(total_concessions * 0.05, 0.2)

        # Penalty for rejections
        reject_penalty = (reject_count / total_verdicts) * 0.3

        return max(0.0, min(1.0, score + concession_bonus - reject_penalty))

    def synthesize_from_rounds(self, result: ProtocolResult) -> SynthesisResult:
        """Create a synthesis purely from structured round data (no LLM needed)."""
        accepted = []
        revised = []
        rejected = []
        all_concessions = []

        for r in result.rounds:
            for arg in r.arguments:
                v = arg.verdict.upper() if arg.verdict else ""
                label = f"[{r.agent_role}] {arg.point}"
                if v == "ACCEPT":
                    accepted.append(label)
                elif v == "REVISE":
                    revised.append(label)
                elif v == "REJECT":
                    rejected.append(label)
            all_concessions.extend(
                f"[{r.agent_role}] {c}" for c in r.concessions
            )

        convergence = self.analyze_convergence(result)

        # Build summary
        summary_parts = []
        if result.converged:
            summary_parts.append("Debate reached convergence.")
        else:
            summary_parts.append(f"Debate completed after {result.total_rounds} rounds without full convergence.")
        summary_parts.append(
            f"Verdicts: {len(accepted)} accepted, {len(revised)} to revise, {len(rejected)} rejected."
        )
        if all_concessions:
            summary_parts.append(f"{len(all_concessions)} concession(s) made.")

        # Final recommendation based on last defender round
        defender_rounds = [r for r in result.rounds if r.agent_role == "defender"]
        recommendation = ""
        if defender_rounds:
            last = defender_rounds[-1]
            recommendation = last.position

        return SynthesisResult(
            summary=" ".join(summary_parts),
            accepted_points=accepted,
            revised_points=revised,
            rejected_points=rejected,
            concessions=all_concessions,
            final_recommendation=recommendation,
            convergence_score=convergence,
            metadata={
                "total_rounds": result.total_rounds,
                "converged": result.converged,
            },
        )

    async def synthesize_with_llm(
        self,
        topic: str,
        result: ProtocolResult,
    ) -> SynthesisResult:
        """Use an LLM to produce a nuanced synthesis of the debate.

        Falls back to synthesize_from_rounds if no LLM is configured.
        """
        if not self.llm:
            return self.synthesize_from_rounds(result)

        # Build debate transcript for the LLM
        transcript_parts = [f"Topic: {topic}\n"]
        for r in result.rounds:
            transcript_parts.append(f"--- {r.agent_role} (Round {r.round_number}) ---")
            transcript_parts.append(f"Position: {r.position}")
            for arg in r.arguments:
                line = f"- {arg.point}"
                if arg.evidence:
                    line += f": {arg.evidence}"
                if arg.verdict:
                    line += f" [{arg.verdict}]"
                transcript_parts.append(line)
            if r.concessions:
                transcript_parts.append(f"Concessions: {', '.join(r.concessions)}")
            transcript_parts.append("")

        system = (
            "You are a neutral synthesis agent. Analyze the debate transcript and produce "
            "a balanced synthesis. Respond with JSON:\n"
            '{"summary": "...", "final_recommendation": "...", '
            '"accepted_points": [...], "revised_points": [...], "rejected_points": [...]}'
        )

        response = await self.llm.generate(
            system=system,
            messages=[LLMMessage(role="user", content="\n".join(transcript_parts))],
            temperature=0.3,
        )

        # Merge LLM synthesis with structural analysis
        base = self.synthesize_from_rounds(result)
        try:
            import json
            data = json.loads(response.content)
            base.summary = data.get("summary", base.summary)
            base.final_recommendation = data.get("final_recommendation", base.final_recommendation)
        except (json.JSONDecodeError, ValueError):
            base.summary = response.content[:500]

        return base
