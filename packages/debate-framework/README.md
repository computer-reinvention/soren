# debate-framework

A multi-agent adversarial debate framework for structured decision-making using LLMs.

## Overview

`debate-framework` orchestrates structured debates between AI agents to produce better decisions. Inspired by real-world adversarial processes (red teams, peer review, parliamentary debate), it pits a **Defender** against a **Critic** to stress-test ideas before committing to them.

## Features

- **Multiple debate protocols**: Adversarial (1v1), Round-Robin (N agents), Panel (proposer + judges)
- **Structured output**: JSON artifacts with positions, arguments, verdicts (ACCEPT/REVISE/REJECT), and concessions
- **Convergence detection**: Automatically detects when agents reach agreement
- **Synthesis engine**: Produces balanced summaries from debate transcripts
- **File-based artifacts**: Save debate rounds as numbered markdown files and JSON
- **Pluggable LLM backends**: Claude, OpenAI, or custom — plus a deterministic mock for testing
- **Zero framework lock-in**: Pure Python, just `httpx` for API calls

## Installation

```bash
pip install debate-framework
```

## Quick Start

```python
import asyncio
from debate import DebateFramework, ClaudeBackend

async def main():
    llm = ClaudeBackend(api_key="sk-ant-...")
    framework = DebateFramework(llm)

    result = await framework.run(
        topic="Should we use microservices or monolith?",
        context="Team of 4, building a SaaS product.",
    )

    print(f"Converged: {result.converged}")
    print(f"Score: {result.convergence_score:.0%}")
    print(f"Recommendation: {result.recommendation}")

asyncio.run(main())
```

## Protocols

### Adversarial (default)
Classic 1v1: Defender proposes, Critic evaluates with ACCEPT/REVISE/REJECT verdicts. 2-3 rounds until convergence or max rounds.

```python
from debate import DebateConfig

config = DebateConfig(topic="...", protocol="adversarial", max_rounds=3)
```

### Round-Robin
N agents take turns, each seeing all prior responses. Good for multi-perspective analysis.

```python
config = DebateConfig(topic="...", protocol="round_robin", max_rounds=2)
```

### Panel
One proposer presents to multiple independent judges. Converges when all judges accept.

```python
from debate import DefenderAgent, CriticAgent

agents = [
    DefenderAgent(llm),
    CriticAgent(llm, system_prompt="Security reviewer"),
    CriticAgent(llm, system_prompt="Performance reviewer"),
]
result = await framework.run(topic="...", agents=agents, config=DebateConfig(topic="", protocol="panel"))
```

## Artifacts

Save debate artifacts to disk for audit trails:

```python
config = DebateConfig(
    topic="...",
    artifact_dir="./debate-output",
)
result = await framework.run(topic="...", config=config)
# Creates: 01-defender.md, 02-critic.md, ..., final-synthesis.md, debate-data.json
```

## Custom LLM Backend

```python
from debate.llm import LLMBackend, LLMResponse, LLMMessage

class MyBackend(LLMBackend):
    async def generate(self, system: str, messages: list[LLMMessage], **kwargs) -> LLMResponse:
        # Your LLM call here
        return LLMResponse(content="...", usage={})
```

## Testing

Uses `MockLLM` for deterministic tests:

```python
from debate import MockLLM

llm = MockLLM(responses=["first response", "second response"])
# or pattern-based:
llm = MockLLM(patterns={"security": "I see security concerns..."})
```

Run the test suite:

```bash
pip install -e ".[dev]"
pytest
```

## License

MIT
