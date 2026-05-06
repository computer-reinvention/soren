"""Auto-redaction middleware for sensitive data.

Scans text for patterns that look like passwords, API keys, or tokens and
replaces them with [REDACTED] before the text reaches persistent storage.

Call redact_sensitive(text) at storage boundaries — message DB writes and
mailbox JSONL writes — so that sensitive data never persists even if
accidentally pasted into chat or a task description.
"""

import re
from typing import Union

# ---------------------------------------------------------------------------
# Pattern registry — ordered from most specific to least specific so that
# overlapping patterns don't interfere with each other.
# ---------------------------------------------------------------------------

_PATTERNS: list[tuple[re.Pattern, Union[str, None]]] = [

    # --- tools/auth output -------------------------------------------------
    # "User 'alice' added. Password: xK9mP2nQ"
    # "Password: somepassword123"
    (
        re.compile(r"(Password:\s+)\S+", re.IGNORECASE),
        r"\1[REDACTED]",
    ),

    # --- JWT / Bearer tokens -----------------------------------------------
    # Full JWT: three base64url segments separated by dots
    (
        re.compile(
            r"\beyJ[A-Za-z0-9_=-]+\.[A-Za-z0-9_=-]+\.[A-Za-z0-9_=-]+"
        ),
        "[REDACTED_JWT]",
    ),
    # Authorization: Bearer <token>
    (
        re.compile(r"(Bearer\s+)[A-Za-z0-9_.\-]{20,}", re.IGNORECASE),
        r"\1[REDACTED]",
    ),

    # --- Known API key prefixes --------------------------------------------
    # Anthropic: sk-ant-api03-...
    (
        re.compile(r"\bsk-ant-[A-Za-z0-9_\-]{20,}"),
        "[REDACTED_API_KEY]",
    ),
    # Generic sk- keys (OpenAI style, also used by others)
    (
        re.compile(r"\bsk-[A-Za-z0-9]{20,}"),
        "[REDACTED_API_KEY]",
    ),
    # GitHub tokens: ghp_, gho_, ghs_, ghr_, github_pat_
    (
        re.compile(r"\b(?:ghp|gho|ghs|ghr)_[A-Za-z0-9]{36,}"),
        "[REDACTED_API_KEY]",
    ),
    (
        re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}"),
        "[REDACTED_API_KEY]",
    ),
    # GitLab personal access tokens: glpat-...
    (
        re.compile(r"\bglpat-[A-Za-z0-9_\-]{20,}"),
        "[REDACTED_API_KEY]",
    ),
    # AWS access keys: AKIA... (20 uppercase alphanumeric)
    (
        re.compile(r"\bAKIA[A-Z0-9]{16}\b"),
        "[REDACTED_API_KEY]",
    ),
    # Slack tokens: xoxb-, xoxp-, xoxa-
    (
        re.compile(r"\bxox[abp]-[A-Za-z0-9\-]{20,}"),
        "[REDACTED_API_KEY]",
    ),
    # Telegram bot tokens: digits:alphanumeric (e.g. 123456789:AAHdqTcvCH1...)
    (
        re.compile(r"\b\d{8,10}:[A-Za-z0-9_\-]{35,}\b"),
        "[REDACTED_API_KEY]",
    ),
    # Laminar API keys (LMNR_ prefix common in this codebase)
    (
        re.compile(r"\bLMNR_[A-Za-z0-9_\-]{20,}"),
        "[REDACTED_API_KEY]",
    ),

    # --- JSON / structured text key-value patterns ------------------------
    # "token": "...", "password": "...", "secret": "...", etc.
    (
        re.compile(
            r'("(?:token|password|secret|api_key|apikey|api[-_]?secret'
            r'|access_token|refresh_token|client_secret)"'
            r'\s*:\s*")[^"]{8,}(")',
            re.IGNORECASE,
        ),
        r"\1[REDACTED]\2",
    ),
    # Same but with single quotes (Python repr style)
    (
        re.compile(
            r"('(?:token|password|secret|api_key|apikey|api[-_]?secret"
            r"|access_token|refresh_token|client_secret)'"
            r"\s*:\s*')[^']{8,}(')",
            re.IGNORECASE,
        ),
        r"\1[REDACTED]\2",
    ),

    # --- High-entropy long strings ----------------------------------------
    # Strings of 40+ chars that are purely alphanumeric + common secret chars
    # (no spaces, no punctuation beyond - _ .) and contain a mix of cases/digits.
    # Length 40+ is conservative enough to avoid false positives on normal words
    # while catching most random secrets.
    (
        re.compile(
            r"(?<![./\w])"                  # not preceded by path/word chars
            r"(?=[A-Za-z0-9_\-]{40,}(?!\S))"  # lookahead: 40+ then end of token
            r"(?=(?:[^a-z]*[a-z]){3,})"    # at least 3 lowercase chars
            r"(?=(?:[^A-Z]*[A-Z]){3,})"    # at least 3 uppercase chars
            r"(?=(?:[^0-9]*[0-9]){2,})"    # at least 2 digits
            r"[A-Za-z0-9_\-]{40,}"
            r"(?!\S)"                       # followed by word boundary
        ),
        "[REDACTED]",
    ),
]


def redact_sensitive(text: str) -> str:
    """Scan text for sensitive patterns and replace with [REDACTED].

    Patterns detected:
    - Password labels: "Password: xxx" (from tools/auth output)
    - JWT tokens (eyJ...header.payload.signature)
    - Bearer tokens in Authorization headers
    - Known API key prefixes: sk-, sk-ant-, ghp_, glpat-, AKIA, xoxb-, Telegram
    - JSON key-value pairs for common secret field names
    - High-entropy strings: 40+ chars with mixed case + digits (likely random keys)

    Designed to be fast and low false-positive — errs on the side of NOT
    redacting ambiguous strings rather than silently munging normal text.
    """
    if not text:
        return text

    result = text
    for pattern, replacement in _PATTERNS:
        result = pattern.sub(replacement, result)
    return result
