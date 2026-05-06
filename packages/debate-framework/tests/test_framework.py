"""Tests for the core debate framework."""

import asyncio
import tempfile

import pytest

from debate import DebateFramework, DebateConfig, DebateResult, MockLLM
from debate.agents import DefenderAgent, CriticAgent


def _make_mock() -> MockLLM:
    """Create a mock LLM with realistic debate responses."""
    return MockLLM(responses=[
        '{"position": "Use approach A", "arguments": [{"point": "Fast", "evidence": "Benchmarks show 2x speed"}], "concessions": []}',
        '{"position": "A is fast but fragile", "arguments": [{"point": "Speed", "evidence": "Valid", "verdict": "ACCEPT"}, {"point": "Error handling", "evidence": "No retry logic", "verdict": "REJECT"}], "concessions": []}',
        '{"position": "Approach A with retries", "arguments": [{"point": "Added retries", "evidence": "Exponential backoff"}], "concessions": ["Error handling was missing"]}',
        '{"position": "Improved proposal", "arguments": [{"point": "Retries added", "evidence": "Addresses concern", "verdict": "ACCEPT"}], "concessions": []}',
    ])


@pytest.mark.asyncio
async def test_basic_debate():
    """Run a basic adversarial debate."""
    llm = _make_mock()
    fw = DebateFramework(llm)
    result = await fw.run(topic="Which approach?", context="Deciding between A and B")

    assert isinstance(result, DebateResult)
    assert result.protocol_result.total_rounds > 0
    assert len(result.protocol_result.rounds) > 0
    assert result.synthesis.summary


@pytest.mark.asyncio
async def test_debate_convergence():
    """Test that debate detects convergence when all verdicts are ACCEPT."""
    llm = MockLLM(responses=[
        '{"position": "Do X", "arguments": [{"point": "Good idea", "evidence": "Data supports it"}], "concessions": []}',
        '{"position": "Agreed", "arguments": [{"point": "Good idea", "evidence": "Confirmed", "verdict": "ACCEPT"}], "concessions": []}',
    ])
    fw = DebateFramework(llm)
    result = await fw.run(topic="Should we do X?")

    assert result.converged is True
    assert result.convergence_score > 0.5


@pytest.mark.asyncio
async def test_debate_no_convergence():
    """Test that debate reports non-convergence correctly."""
    llm = MockLLM(responses=[
        '{"position": "Do X", "arguments": [{"point": "A", "evidence": "..."}], "concessions": []}',
        '{"position": "No", "arguments": [{"point": "A", "evidence": "Bad", "verdict": "REJECT"}], "concessions": []}',
        '{"position": "Still X", "arguments": [{"point": "A", "evidence": "..."}], "concessions": []}',
        '{"position": "Still no", "arguments": [{"point": "A", "evidence": "Bad", "verdict": "REJECT"}], "concessions": []}',
        '{"position": "X final", "arguments": [{"point": "A", "evidence": "..."}], "concessions": []}',
        '{"position": "No final", "arguments": [{"point": "A", "evidence": "Bad", "verdict": "REJECT"}], "concessions": []}',
    ])
    fw = DebateFramework(llm)
    result = await fw.run(topic="Should we do X?")

    assert result.converged is False


@pytest.mark.asyncio
async def test_debate_with_artifacts():
    """Test that artifacts are saved when configured."""
    llm = _make_mock()

    with tempfile.TemporaryDirectory() as tmpdir:
        config = DebateConfig(
            topic="",
            protocol="adversarial",
            max_rounds=2,
            artifact_dir=tmpdir,
        )
        fw = DebateFramework(llm)
        result = await fw.run(topic="Test topic", config=config)

        assert len(result.artifact_paths) > 0
        for p in result.artifact_paths:
            assert p.exists()
        # Should have round files + synthesis + JSON
        names = [p.name for p in result.artifact_paths]
        assert "final-synthesis.md" in names
        assert "debate-data.json" in names


@pytest.mark.asyncio
async def test_custom_agents():
    """Test using custom agents with custom system prompts."""
    llm = _make_mock()
    agents = [
        DefenderAgent(llm, system_prompt="You are a security-focused advocate."),
        CriticAgent(llm, system_prompt="You are a performance-focused critic."),
    ]
    fw = DebateFramework(llm)
    result = await fw.run(
        topic="Security vs performance tradeoff",
        agents=agents,
    )
    assert len(result.protocol_result.rounds) > 0


@pytest.mark.asyncio
async def test_debate_result_properties():
    """Test DebateResult convenience properties."""
    llm = _make_mock()
    fw = DebateFramework(llm)
    result = await fw.run(topic="Test")

    assert isinstance(result.converged, bool)
    assert isinstance(result.convergence_score, float)
    assert 0.0 <= result.convergence_score <= 1.0
    assert isinstance(result.summary, str)
    assert isinstance(result.recommendation, str)


@pytest.mark.asyncio
async def test_invalid_protocol():
    """Test that invalid protocol name raises ValueError."""
    config = DebateConfig(topic="Test", protocol="invalid")
    with pytest.raises(ValueError, match="Unknown protocol"):
        config.get_protocol()


@pytest.mark.asyncio
async def test_mock_llm_call_history():
    """Test that MockLLM records call history."""
    llm = _make_mock()
    fw = DebateFramework(llm)
    await fw.run(topic="Test")

    assert len(llm.call_history) > 0
    assert "system" in llm.call_history[0]
    assert "messages" in llm.call_history[0]
