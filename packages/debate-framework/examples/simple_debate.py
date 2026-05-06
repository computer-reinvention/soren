"""Minimal example: run an adversarial debate with Claude."""

import asyncio

from debate import DebateFramework, ClaudeBackend, MockLLM


async def main():
    # Use MockLLM for a quick demo (replace with ClaudeBackend for real usage)
    llm = MockLLM(responses=[
        '{"position": "Microservices allow independent scaling and deployment", '
        '"arguments": [{"point": "Independent scaling", "evidence": "Each service scales based on its own load"},'
        '{"point": "Team autonomy", "evidence": "Teams own their service end-to-end"}], "concessions": []}',

        '{"position": "Monolith is simpler for a small team", '
        '"arguments": [{"point": "Operational complexity", "evidence": "4 engineers cannot manage 10+ services", "verdict": "REJECT"},'
        '{"point": "Team autonomy", "evidence": "Valid for larger orgs, premature here", "verdict": "REVISE"}], "concessions": []}',

        '{"position": "Start monolith, extract services when needed", '
        '"arguments": [{"point": "Modular monolith first", "evidence": "Clean boundaries without deployment overhead"},'
        '{"point": "Extract when metrics justify", "evidence": "Data-driven service extraction"}], '
        '"concessions": ["Operational complexity is real for a 4-person team"]}',

        '{"position": "Modular monolith is the right starting point", '
        '"arguments": [{"point": "Modular monolith", "evidence": "Good compromise", "verdict": "ACCEPT"},'
        '{"point": "Extraction criteria", "evidence": "Need concrete thresholds", "verdict": "REVISE"}], "concessions": []}',
    ])

    # For real usage:
    # llm = ClaudeBackend(api_key="sk-ant-...")

    framework = DebateFramework(llm)
    result = await framework.run(
        topic="Should we use microservices or monolith?",
        context="Building a new SaaS product with a team of 4 engineers.",
    )

    print(f"Converged: {result.converged}")
    print(f"Convergence score: {result.convergence_score:.0%}")
    print(f"Summary: {result.summary}")
    print(f"Recommendation: {result.recommendation}")


if __name__ == "__main__":
    asyncio.run(main())
