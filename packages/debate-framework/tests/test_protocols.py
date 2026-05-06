"""Tests for debate protocols."""

import pytest

from debate.agents import CriticAgent, DefenderAgent
from debate.llm import MockLLM
from debate.protocols import AdversarialProtocol, PanelProtocol, RoundRobinProtocol


def _agents(llm: MockLLM, n: int = 2) -> list:
    agents = [DefenderAgent(llm)]
    for i in range(n - 1):
        c = CriticAgent(llm)
        c.role = f"critic-{i}" if n > 2 else "critic"
        agents.append(c)
    return agents


@pytest.mark.asyncio
async def test_adversarial_requires_two_agents():
    llm = MockLLM(default_response='{"position":"x","arguments":[],"concessions":[]}')
    protocol = AdversarialProtocol()

    with pytest.raises(ValueError, match="exactly 2"):
        await protocol.run("Topic", "Context", [DefenderAgent(llm)])


@pytest.mark.asyncio
async def test_adversarial_runs_rounds():
    llm = MockLLM(default_response='{"position":"x","arguments":[{"point":"a","evidence":"b"}],"concessions":[]}')
    protocol = AdversarialProtocol()
    agents = _agents(llm)

    result = await protocol.run("Topic", "Context", agents, max_rounds=2)

    # 2 rounds × 2 agents = 4 total entries
    assert result.total_rounds == 4
    assert len(result.rounds) == 4


@pytest.mark.asyncio
async def test_adversarial_early_convergence():
    llm = MockLLM(responses=[
        '{"position":"yes","arguments":[{"point":"a","evidence":"b"}],"concessions":[]}',
        '{"position":"agreed","arguments":[{"point":"a","evidence":"ok","verdict":"ACCEPT"}],"concessions":[]}',
    ])
    protocol = AdversarialProtocol()
    agents = _agents(llm)

    result = await protocol.run("Topic", "Context", agents, max_rounds=5)

    assert result.converged is True
    assert result.total_rounds == 2  # Stopped early


@pytest.mark.asyncio
async def test_round_robin_all_agents_participate():
    llm = MockLLM(default_response='{"position":"x","arguments":[{"point":"a","evidence":"b"}],"concessions":[]}')
    protocol = RoundRobinProtocol()
    agents = _agents(llm, n=3)

    result = await protocol.run("Topic", "Context", agents, max_rounds=2)

    # 2 rounds × 3 agents = 6
    assert result.total_rounds == 6
    roles = [r.agent_role for r in result.rounds]
    assert "defender" in roles


@pytest.mark.asyncio
async def test_round_robin_requires_two():
    llm = MockLLM(default_response='{"position":"x","arguments":[],"concessions":[]}')
    protocol = RoundRobinProtocol()

    with pytest.raises(ValueError, match="at least 2"):
        await protocol.run("T", "C", [DefenderAgent(llm)])


@pytest.mark.asyncio
async def test_panel_proposer_and_judges():
    responses = [
        '{"position":"proposal","arguments":[{"point":"a","evidence":"b"}],"concessions":[]}',
        '{"position":"judge1","arguments":[{"point":"a","evidence":"ok","verdict":"ACCEPT"}],"concessions":[]}',
        '{"position":"judge2","arguments":[{"point":"a","evidence":"ok","verdict":"ACCEPT"}],"concessions":[]}',
    ]
    llm = MockLLM(responses=responses)
    protocol = PanelProtocol()
    agents = _agents(llm, n=3)

    result = await protocol.run("Topic", "Context", agents, max_rounds=2)

    # Should converge in first cycle (all judges ACCEPT)
    assert result.converged is True
    assert result.metadata.get("convergence_reason") == "panel_unanimous"


@pytest.mark.asyncio
async def test_panel_requires_two():
    llm = MockLLM(default_response='{"position":"x","arguments":[],"concessions":[]}')
    protocol = PanelProtocol()

    with pytest.raises(ValueError, match="at least 2"):
        await protocol.run("T", "C", [DefenderAgent(llm)])
