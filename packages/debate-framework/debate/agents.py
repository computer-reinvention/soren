"""Debate agent roles: Defender and Critic."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from debate.llm import LLMBackend, LLMMessage


@dataclass
class Argument:
    """A single argument within a debate round."""
    point: str
    evidence: str = ""
    verdict: str = ""  # ACCEPT, REVISE, REJECT (used by critic)


@dataclass
class DebateRound:
    """One round of debate output from an agent."""
    agent_role: str
    round_number: int
    position: str
    arguments: list[Argument]
    concessions: list[str] = field(default_factory=list)
    raw_content: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "agent_role": self.agent_role,
            "round_number": self.round_number,
            "position": self.position,
            "arguments": [
                {"point": a.point, "evidence": a.evidence, "verdict": a.verdict}
                for a in self.arguments
            ],
            "concessions": self.concessions,
        }


DEFENDER_SYSTEM = """You are the Defender in a structured adversarial debate. Your role:

1. ADVOCATE for the proposed position with evidence and reasoning
2. Be an ADVOCATE, not an evangelist — acknowledge real weaknesses
3. Respond CONSTRUCTIVELY to critiques — concede valid points, defend where warranted
4. Structure your response as JSON with this format:

{
    "position": "Your core position statement",
    "arguments": [
        {"point": "Key argument", "evidence": "Supporting evidence or reasoning"}
    ],
    "concessions": ["Any points you concede from the critique"]
}

Be specific and grounded. Use concrete examples, not abstractions."""


CRITIC_SYSTEM = """You are the Critic in a structured adversarial debate. Your role:

1. Evaluate the Defender's proposal with HEALTHY SKEPTICISM
2. Be SPECIFIC — cite exact claims and explain why they're problematic
3. Be CONSTRUCTIVE — suggest improvements, don't just tear down
4. Use VERDICTS for each major point: ACCEPT, REVISE, or REJECT
5. Structure your response as JSON with this format:

{
    "position": "Your overall assessment",
    "arguments": [
        {"point": "Issue or observation", "evidence": "Why this matters", "verdict": "ACCEPT|REVISE|REJECT"}
    ],
    "concessions": []
}

Red flags to watch for: over-engineering, missing error handling, performance blindspots,
security holes, premature abstraction, integration gaps."""


class DebateAgent:
    """Base class for debate agents."""

    def __init__(self, role: str, llm: LLMBackend, system_prompt: str):
        self.role = role
        self.llm = llm
        self.system_prompt = system_prompt
        self.history: list[DebateRound] = []

    async def respond(
        self,
        topic: str,
        context: str,
        round_number: int,
        opponent_rounds: list[DebateRound] | None = None,
    ) -> DebateRound:
        """Generate a debate response."""
        messages: list[LLMMessage] = []

        # Build conversation context
        prompt_parts = [f"Topic: {topic}\n\nContext: {context}"]

        if opponent_rounds:
            for r in opponent_rounds:
                prompt_parts.append(
                    f"\n--- {r.agent_role} (Round {r.round_number}) ---\n"
                    f"Position: {r.position}\n"
                    + "\n".join(
                        f"- {a.point}: {a.evidence}"
                        + (f" [{a.verdict}]" if a.verdict else "")
                        for a in r.arguments
                    )
                )

        if self.history:
            prompt_parts.append(
                f"\nYour previous position: {self.history[-1].position}"
            )

        prompt_parts.append(
            f"\nThis is round {round_number}. "
            f"Respond with your structured JSON analysis."
        )

        messages.append(LLMMessage(role="user", content="\n".join(prompt_parts)))

        response = await self.llm.generate(
            system=self.system_prompt,
            messages=messages,
            temperature=0.7,
        )

        debate_round = self._parse_response(response.content, round_number)
        self.history.append(debate_round)
        return debate_round

    def _parse_response(self, content: str, round_number: int) -> DebateRound:
        """Parse LLM response into a DebateRound."""
        try:
            # Try to extract JSON from response
            data = _extract_json(content)
            arguments = [
                Argument(
                    point=a.get("point", ""),
                    evidence=a.get("evidence", ""),
                    verdict=a.get("verdict", ""),
                )
                for a in data.get("arguments", [])
            ]
            return DebateRound(
                agent_role=self.role,
                round_number=round_number,
                position=data.get("position", content[:200]),
                arguments=arguments,
                concessions=data.get("concessions", []),
                raw_content=content,
            )
        except (json.JSONDecodeError, ValueError):
            # Fallback: treat entire response as a single argument
            return DebateRound(
                agent_role=self.role,
                round_number=round_number,
                position=content[:200],
                arguments=[Argument(point=content, evidence="")],
                raw_content=content,
            )


class DefenderAgent(DebateAgent):
    """Advocates for a position with evidence-based arguments."""

    def __init__(self, llm: LLMBackend, system_prompt: str | None = None):
        super().__init__(
            role="defender",
            llm=llm,
            system_prompt=system_prompt or DEFENDER_SYSTEM,
        )


class CriticAgent(DebateAgent):
    """Evaluates proposals with structured critique and verdicts."""

    def __init__(self, llm: LLMBackend, system_prompt: str | None = None):
        super().__init__(
            role="critic",
            llm=llm,
            system_prompt=system_prompt or CRITIC_SYSTEM,
        )


def _extract_json(text: str) -> dict:
    """Extract JSON object from text that may contain markdown fences or prose."""
    # Try direct parse
    text = text.strip()
    if text.startswith("{"):
        return json.loads(text)

    # Try to find JSON block in markdown fences
    import re
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if match:
        return json.loads(match.group(1))

    # Try to find any JSON object
    start = text.find("{")
    if start != -1:
        # Find matching closing brace
        depth = 0
        for i, ch in enumerate(text[start:], start):
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return json.loads(text[start : i + 1])

    raise ValueError("No JSON found in response")
