"""Core debate orchestration framework."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from debate.agents import CriticAgent, DebateAgent, DefenderAgent
from debate.artifacts import ArtifactStore
from debate.llm import LLMBackend
from debate.protocols import (
    AdversarialProtocol,
    DebateProtocol,
    PanelProtocol,
    ProtocolResult,
    RoundRobinProtocol,
)
from debate.synthesis import SynthesisEngine, SynthesisResult


@dataclass
class DebateConfig:
    """Configuration for a debate session."""
    topic: str
    context: str = ""
    protocol: str = "adversarial"  # adversarial, round_robin, panel
    max_rounds: int = 3
    artifact_dir: str | None = None
    synthesis_llm: LLMBackend | None = None  # Separate LLM for synthesis (optional)

    def get_protocol(self) -> DebateProtocol:
        protocols = {
            "adversarial": AdversarialProtocol,
            "round_robin": RoundRobinProtocol,
            "panel": PanelProtocol,
        }
        cls = protocols.get(self.protocol)
        if not cls:
            raise ValueError(
                f"Unknown protocol '{self.protocol}'. "
                f"Choose from: {', '.join(protocols)}"
            )
        return cls()


@dataclass
class DebateResult:
    """Complete result of a debate session."""
    protocol_result: ProtocolResult
    synthesis: SynthesisResult
    artifact_paths: list[Path] = field(default_factory=list)

    @property
    def converged(self) -> bool:
        return self.protocol_result.converged

    @property
    def convergence_score(self) -> float:
        return self.synthesis.convergence_score

    @property
    def summary(self) -> str:
        return self.synthesis.summary

    @property
    def recommendation(self) -> str:
        return self.synthesis.final_recommendation


class DebateFramework:
    """High-level orchestrator for multi-agent debates.

    Usage:
        llm = ClaudeBackend(api_key="...")
        framework = DebateFramework(llm)
        result = await framework.run(
            topic="Should we use microservices or monolith?",
            context="Building a new SaaS product, team of 4 engineers.",
        )
        print(result.summary)
        print(result.recommendation)
    """

    def __init__(self, llm: LLMBackend):
        self.llm = llm

    async def run(
        self,
        topic: str,
        context: str = "",
        *,
        config: DebateConfig | None = None,
        agents: list[DebateAgent] | None = None,
    ) -> DebateResult:
        """Run a complete debate session.

        Args:
            topic: The question or decision to debate.
            context: Background information for the debate.
            config: Optional configuration. Defaults to adversarial, 3 rounds.
            agents: Optional custom agents. If not provided, creates default
                    defender/critic pair.

        Returns:
            DebateResult with protocol output, synthesis, and artifact paths.
        """
        if config is None:
            config = DebateConfig(topic=topic, context=context)
        else:
            config.topic = topic
            config.context = context

        # Create default agents if none provided
        if agents is None:
            agents = [
                DefenderAgent(self.llm),
                CriticAgent(self.llm),
            ]

        # Run the protocol
        protocol = config.get_protocol()
        protocol_result = await protocol.run(
            topic=config.topic,
            context=config.context,
            agents=agents,
            max_rounds=config.max_rounds,
        )

        # Synthesize results
        engine = SynthesisEngine(llm=config.synthesis_llm)
        if config.synthesis_llm:
            synthesis = await engine.synthesize_with_llm(topic, protocol_result)
        else:
            synthesis = engine.synthesize_from_rounds(protocol_result)

        # Save artifacts if configured
        artifact_paths: list[Path] = []
        if config.artifact_dir:
            store = ArtifactStore(base_dir=Path(config.artifact_dir))
            for r in protocol_result.rounds:
                path = store.save_round(r)
                artifact_paths.append(path)
            artifact_paths.append(store.save_synthesis(synthesis))
            artifact_paths.append(store.save_json(protocol_result, synthesis))

        return DebateResult(
            protocol_result=protocol_result,
            synthesis=synthesis,
            artifact_paths=artifact_paths,
        )
