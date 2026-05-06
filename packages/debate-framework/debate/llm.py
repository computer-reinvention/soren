"""Pluggable LLM backends for debate agents."""

from __future__ import annotations

import json
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

import httpx


@dataclass
class LLMMessage:
    """A message in a conversation."""
    role: str  # "user" or "assistant"
    content: str


@dataclass
class LLMResponse:
    """Response from an LLM call."""
    content: str
    usage: dict[str, int] = field(default_factory=dict)
    raw: dict[str, Any] | None = None


class LLMBackend(ABC):
    """Abstract base class for LLM backends."""

    @abstractmethod
    async def generate(
        self,
        system: str,
        messages: list[LLMMessage],
        *,
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> LLMResponse:
        """Generate a response from the LLM."""
        ...


class ClaudeBackend(LLMBackend):
    """Anthropic Claude API backend."""

    def __init__(
        self,
        api_key: str | None = None,
        model: str = "claude-sonnet-4-20250514",
        base_url: str = "https://api.anthropic.com",
    ):
        self.api_key = api_key or os.environ.get("ANTHROPIC_API_KEY", "")
        self.model = model
        self.base_url = base_url

    async def generate(
        self,
        system: str,
        messages: list[LLMMessage],
        *,
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> LLMResponse:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self.base_url}/v1/messages",
                headers={
                    "x-api-key": self.api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": self.model,
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                    "system": system,
                    "messages": [
                        {"role": m.role, "content": m.content} for m in messages
                    ],
                },
                timeout=120.0,
            )
            resp.raise_for_status()
            data = resp.json()
            return LLMResponse(
                content=data["content"][0]["text"],
                usage=data.get("usage", {}),
                raw=data,
            )


class OpenAIBackend(LLMBackend):
    """OpenAI API backend."""

    def __init__(
        self,
        api_key: str | None = None,
        model: str = "gpt-4o",
        base_url: str = "https://api.openai.com",
    ):
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY", "")
        self.model = model
        self.base_url = base_url

    async def generate(
        self,
        system: str,
        messages: list[LLMMessage],
        *,
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> LLMResponse:
        oai_messages = [{"role": "system", "content": system}]
        oai_messages.extend(
            {"role": m.role, "content": m.content} for m in messages
        )
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self.base_url}/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.model,
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                    "messages": oai_messages,
                },
                timeout=120.0,
            )
            resp.raise_for_status()
            data = resp.json()
            return LLMResponse(
                content=data["choices"][0]["message"]["content"],
                usage=data.get("usage", {}),
                raw=data,
            )


class MockLLM(LLMBackend):
    """Deterministic mock LLM for testing.

    Supports two modes:
    - Scripted: provide a list of responses that are returned in order.
    - Pattern-based: provide a dict mapping keywords to responses.
    """

    def __init__(
        self,
        responses: list[str] | None = None,
        patterns: dict[str, str] | None = None,
        default_response: str = "I agree with the points raised.",
    ):
        self.responses = list(responses) if responses else []
        self.patterns = patterns or {}
        self.default_response = default_response
        self._call_count = 0
        self.call_history: list[dict[str, Any]] = []

    async def generate(
        self,
        system: str,
        messages: list[LLMMessage],
        *,
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> LLMResponse:
        self.call_history.append({
            "system": system,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "call_number": self._call_count,
        })

        # Check scripted responses first
        if self._call_count < len(self.responses):
            content = self.responses[self._call_count]
        else:
            # Check pattern matches against last user message
            last_msg = messages[-1].content if messages else ""
            content = self.default_response
            for keyword, response in self.patterns.items():
                if keyword.lower() in last_msg.lower():
                    content = response
                    break

        self._call_count += 1
        return LLMResponse(
            content=content,
            usage={"input_tokens": 100, "output_tokens": 50},
        )
