"""debate-framework: Multi-agent adversarial debate for structured decision-making."""

from debate.agents import CriticAgent, DefenderAgent
from debate.framework import DebateFramework, DebateConfig, DebateResult
from debate.llm import LLMBackend, ClaudeBackend, OpenAIBackend, MockLLM
from debate.protocols import AdversarialProtocol, RoundRobinProtocol, PanelProtocol
from debate.synthesis import SynthesisEngine

__version__ = "0.1.0"

__all__ = [
    "DebateFramework",
    "DebateConfig",
    "DebateResult",
    "DefenderAgent",
    "CriticAgent",
    "LLMBackend",
    "ClaudeBackend",
    "OpenAIBackend",
    "MockLLM",
    "AdversarialProtocol",
    "RoundRobinProtocol",
    "PanelProtocol",
    "SynthesisEngine",
]
