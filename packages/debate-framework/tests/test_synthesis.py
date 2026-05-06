"""Tests for synthesis and convergence detection."""

import pytest

from debate.agents import Argument, DebateRound
from debate.llm import MockLLM
from debate.protocols import ProtocolResult
from debate.synthesis import SynthesisEngine, SynthesisResult


def _make_rounds(verdicts: list[str], concessions: list[list[str]] | None = None) -> ProtocolResult:
    """Helper to create a ProtocolResult with specific verdicts."""
    rounds = []
    for i, verdict in enumerate(verdicts):
        role = "defender" if i % 2 == 0 else "critic"
        args = [Argument(point=f"Point {i}", evidence="Evidence", verdict=verdict if role == "critic" else "")]
        c = concessions[i] if concessions and i < len(concessions) else []
        rounds.append(DebateRound(
            agent_role=role,
            round_number=i + 1,
            position=f"Position {i}",
            arguments=args,
            concessions=c,
        ))
    return ProtocolResult(rounds=rounds, total_rounds=len(rounds), converged=False)


def test_convergence_all_accept():
    engine = SynthesisEngine()
    result = _make_rounds(["", "ACCEPT", "", "ACCEPT"])
    score = engine.analyze_convergence(result)
    assert score > 0.8


def test_convergence_all_reject():
    engine = SynthesisEngine()
    result = _make_rounds(["", "REJECT", "", "REJECT"])
    score = engine.analyze_convergence(result)
    assert score < 0.3


def test_convergence_mixed():
    engine = SynthesisEngine()
    result = _make_rounds(["", "ACCEPT", "", "REVISE", "", "REJECT"])
    score = engine.analyze_convergence(result)
    assert 0.0 < score < 1.0


def test_convergence_with_concessions():
    engine = SynthesisEngine()
    result = _make_rounds(
        ["", "REVISE"],
        concessions=[["I concede point X", "I concede point Y"], []],
    )
    score = engine.analyze_convergence(result)
    # Concessions should boost score slightly
    result_no_concessions = _make_rounds(["", "REVISE"])
    score_no = engine.analyze_convergence(result_no_concessions)
    assert score >= score_no


def test_convergence_empty_rounds():
    engine = SynthesisEngine()
    result = ProtocolResult(rounds=[], total_rounds=0, converged=False)
    assert engine.analyze_convergence(result) == 0.0


def test_convergence_no_verdicts():
    engine = SynthesisEngine()
    rounds = [DebateRound(
        agent_role="defender",
        round_number=1,
        position="Test",
        arguments=[Argument(point="No verdict", evidence="")],
    )]
    result = ProtocolResult(rounds=rounds, total_rounds=1, converged=False)
    score = engine.analyze_convergence(result)
    assert score == 0.5  # Default when no verdicts


def test_synthesize_from_rounds():
    engine = SynthesisEngine()
    result = _make_rounds(["", "ACCEPT", "", "REVISE", "", "REJECT"])
    synthesis = engine.synthesize_from_rounds(result)

    assert isinstance(synthesis, SynthesisResult)
    assert len(synthesis.accepted_points) == 1
    assert len(synthesis.revised_points) == 1
    assert len(synthesis.rejected_points) == 1
    assert "3 rounds" not in synthesis.summary or "6 rounds" in synthesis.summary


def test_synthesize_converged():
    engine = SynthesisEngine()
    result = _make_rounds(["", "ACCEPT"])
    result.converged = True
    synthesis = engine.synthesize_from_rounds(result)

    assert "convergence" in synthesis.summary.lower()


def test_synthesis_to_dict():
    engine = SynthesisEngine()
    result = _make_rounds(["", "ACCEPT"])
    synthesis = engine.synthesize_from_rounds(result)

    d = synthesis.to_dict()
    assert "summary" in d
    assert "convergence_score" in d
    assert "accepted_points" in d
    assert isinstance(d["convergence_score"], float)


@pytest.mark.asyncio
async def test_synthesize_with_llm_fallback():
    """When no LLM is set, synthesize_with_llm falls back to structural analysis."""
    engine = SynthesisEngine(llm=None)
    result = _make_rounds(["", "ACCEPT"])
    synthesis = await engine.synthesize_with_llm("Test topic", result)

    assert isinstance(synthesis, SynthesisResult)
    assert synthesis.summary  # Should still produce output


@pytest.mark.asyncio
async def test_synthesize_with_mock_llm():
    llm = MockLLM(responses=[
        '{"summary": "LLM synthesis: both sides agree on core approach", '
        '"final_recommendation": "Go with option A with modifications", '
        '"accepted_points": ["Core architecture"], '
        '"revised_points": ["Error handling"], '
        '"rejected_points": []}'
    ])
    engine = SynthesisEngine(llm=llm)
    result = _make_rounds(["", "ACCEPT"])
    synthesis = await engine.synthesize_with_llm("Test topic", result)

    assert "LLM synthesis" in synthesis.summary
    assert "option A" in synthesis.final_recommendation
