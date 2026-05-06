"""File-based artifact exchange between debate agents."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from debate.agents import DebateRound
from debate.protocols import ProtocolResult
from debate.synthesis import SynthesisResult


@dataclass
class ArtifactStore:
    """Manages file-based artifacts for a debate session."""

    base_dir: Path

    def __post_init__(self):
        self.base_dir = Path(self.base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def save_round(self, debate_round: DebateRound) -> Path:
        """Save a debate round as a numbered markdown artifact."""
        num = str(debate_round.round_number).zfill(2)
        filename = f"{num}-{debate_round.agent_role}.md"
        path = self.base_dir / filename

        lines = [
            f"# {debate_round.agent_role.title()} — Round {debate_round.round_number}",
            "",
            f"**Position:** {debate_round.position}",
            "",
            "## Arguments",
            "",
        ]

        for arg in debate_round.arguments:
            verdict = f" [{arg.verdict}]" if arg.verdict else ""
            lines.append(f"### {arg.point}{verdict}")
            if arg.evidence:
                lines.append(f"\n{arg.evidence}")
            lines.append("")

        if debate_round.concessions:
            lines.append("## Concessions")
            lines.append("")
            for c in debate_round.concessions:
                lines.append(f"- {c}")
            lines.append("")

        path.write_text("\n".join(lines))
        return path

    def save_synthesis(self, synthesis: SynthesisResult) -> Path:
        """Save the final synthesis as a markdown file."""
        path = self.base_dir / "final-synthesis.md"

        lines = [
            "# Debate Synthesis",
            "",
            f"**Convergence Score:** {synthesis.convergence_score:.0%}",
            "",
            "## Summary",
            "",
            synthesis.summary,
            "",
        ]

        if synthesis.accepted_points:
            lines.extend(["## Accepted", ""])
            lines.extend(f"- {p}" for p in synthesis.accepted_points)
            lines.append("")

        if synthesis.revised_points:
            lines.extend(["## Needs Revision", ""])
            lines.extend(f"- {p}" for p in synthesis.revised_points)
            lines.append("")

        if synthesis.rejected_points:
            lines.extend(["## Rejected", ""])
            lines.extend(f"- {p}" for p in synthesis.rejected_points)
            lines.append("")

        if synthesis.concessions:
            lines.extend(["## Concessions", ""])
            lines.extend(f"- {c}" for c in synthesis.concessions)
            lines.append("")

        lines.extend([
            "## Final Recommendation",
            "",
            synthesis.final_recommendation,
            "",
        ])

        path.write_text("\n".join(lines))
        return path

    def save_json(self, result: ProtocolResult, synthesis: SynthesisResult) -> Path:
        """Save complete debate data as JSON for programmatic access."""
        path = self.base_dir / "debate-data.json"

        data = {
            "timestamp": datetime.now().isoformat(),
            "total_rounds": result.total_rounds,
            "converged": result.converged,
            "rounds": [r.to_dict() for r in result.rounds],
            "synthesis": synthesis.to_dict(),
            "metadata": result.metadata,
        }

        path.write_text(json.dumps(data, indent=2))
        return path

    def load_rounds(self) -> list[dict[str, Any]]:
        """Load all rounds from the JSON data file."""
        path = self.base_dir / "debate-data.json"
        if not path.exists():
            return []
        data = json.loads(path.read_text())
        return data.get("rounds", [])

    def list_artifacts(self) -> list[Path]:
        """List all artifact files in the store."""
        return sorted(self.base_dir.iterdir())
