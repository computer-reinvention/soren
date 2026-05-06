"""Pattern extraction — identify reusable solution patterns from commits and journal entries.

Patterns are stored in the memory store with source_type='pattern' so they're
discoverable alongside journal/artifact memories in semantic search.
"""

import re
import subprocess
import logging
from pathlib import Path
from typing import Optional

from ..config import settings
from .memory_store import memory_store

logger = logging.getLogger(__name__)

# Commit body keywords that signal a convention/lesson
_KEYWORD_RE = re.compile(
    r'\b(always|must|never|avoid|prefer|convention|pattern|rule|ensure|remember|'
    r'note:|tip:|important:|lesson:|fix pattern|feature pattern)\b',
    re.IGNORECASE,
)

# Journal section headings that contain extractable patterns
_PATTERN_SECTION_RE = re.compile(
    r'\b(key decisions?|lessons?|what worked|what.?s? next|patterns?|'
    r'reflections?|conventions?|notes?|tips?|important)\b',
    re.IGNORECASE,
)

# File-level structural patterns: (description, set of path fragments that must ALL appear)
_STRUCTURAL_PATTERNS = [
    (
        "When adding a new API route, register it in both the routes/ module and "
        "src/server/main.py (app.include_router call)",
        ["routes/", "main.py"],
        "high",
    ),
    (
        "For SQLite schema migrations, use PRAGMA table_info to check existing columns "
        "before ALTER TABLE ADD COLUMN — makes migrations idempotent",
        ["services/", ".py"],
        None,  # Only emit when commit message also mentions migration/column/ALTER
    ),
    (
        "Frontend components go in src/frontend/src/components/<category>/ — "
        "group by feature not by type",
        ["src/frontend/src/components/", ".tsx"],
        "medium",
    ),
    (
        "New tools (tools/) should be executable bash scripts with inline Python via "
        "'uv run python -' for complex logic",
        ["tools/"],
        "medium",
    ),
]


def _run_git(args: list[str], cwd: Optional[Path] = None) -> str:
    """Run a git command, return stdout. Returns '' on failure."""
    try:
        return subprocess.check_output(
            ["git"] + args,
            text=True,
            cwd=str(cwd or Path(".")),
            timeout=15,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError):
        return ""


def extract_patterns_from_commit(commit_sha: str) -> list[dict]:
    """Extract reusable patterns from a git commit.

    Looks at commit message body for convention/lesson keywords and
    identifies structural file patterns (e.g. routes + main.py → route registration).

    Returns list of {pattern, source_commit, files, confidence}.
    """
    short_sha = commit_sha[:7] if len(commit_sha) > 7 else commit_sha

    # Commit message (body only — skip first line subject)
    raw_msg = _run_git(["show", "--format=%B", "--no-patch", commit_sha])
    if not raw_msg:
        return []

    lines = raw_msg.splitlines()
    subject = lines[0].strip() if lines else ""
    body_lines = [l.strip() for l in lines[2:] if l.strip()]  # skip subject + blank line

    # Changed files from --stat
    stat_out = _run_git(["show", "--stat", "--format=", commit_sha])
    changed_files = []
    for line in stat_out.splitlines():
        if "|" in line:
            f = line.split("|")[0].strip()
            if f and not f.startswith(" "):
                changed_files.append(f)

    patterns: list[dict] = []

    # --- Body-line keyword extraction ---
    for line in body_lines:
        clean = line.lstrip("-*•").strip()
        if len(clean) < 25:
            continue
        if _KEYWORD_RE.search(clean):
            patterns.append({
                "pattern": clean,
                "source_commit": short_sha,
                "files": changed_files[:6],
                "confidence": "high",
            })

    # --- Structural file patterns ---
    for description, fragments, confidence in _STRUCTURAL_PATTERNS:
        if confidence is None:
            # Conditional: emit only if commit message references migration keywords
            if not re.search(r'\b(migrat|ALTER|column|schema)\b', raw_msg, re.IGNORECASE):
                continue
            confidence = "medium"

        if all(any(frag in f for f in changed_files) for frag in fragments):
            patterns.append({
                "pattern": description,
                "source_commit": short_sha,
                "files": changed_files[:6],
                "confidence": confidence,
            })

    # --- Dedup within this commit ---
    seen: set[str] = set()
    unique: list[dict] = []
    for p in patterns:
        key = p["pattern"][:80]
        if key not in seen:
            seen.add(key)
            unique.append(p)

    return unique


def extract_patterns_from_journal(date: str) -> list[dict]:
    """Extract reusable patterns from a journal entry for the given date (YYYY-MM-DD).

    Looks for sections named: Key decisions, Lessons, What worked, Pattern,
    Reflection, Convention, Notes, Tips — and extracts their bullet points.

    Returns list of {pattern, source_commit, files, confidence}.
    """
    journal_file = settings.soren_dir / "journal" / date / "journal.md"
    if not journal_file.exists():
        return []

    text = journal_file.read_text(errors="replace")
    patterns: list[dict] = []

    # Split into sections on any ## header
    chunks = re.split(r'^(#{1,3} .+)$', text, flags=re.MULTILINE)

    i = 1  # skip preamble
    current_section_header = ""
    while i < len(chunks):
        header = chunks[i].strip()
        body = chunks[i + 1].strip() if i + 1 < len(chunks) else ""
        i += 2

        # Check if this section is a "pattern-bearing" section
        if not _PATTERN_SECTION_RE.search(header):
            current_section_header = header
            continue

        # Extract bullet points from the body
        for line in body.splitlines():
            clean = line.strip().lstrip("-*•").strip()
            if len(clean) < 25:
                continue
            # Skip lines that are just sub-headers or timestamps
            if clean.startswith("#") or re.match(r'^\d{2}:\d{2}', clean):
                continue
            patterns.append({
                "pattern": clean,
                "source_commit": "",
                "files": [],
                "confidence": "medium",
            })

    # Also extract "Reflection:" inline entries (## HH:MM - Reflection: topic)
    reflection_re = re.compile(
        r'^#{1,3} \d{2}:\d{2} - Reflection: .+$', re.MULTILINE
    )
    for m in reflection_re.finditer(text):
        # Grab the next 300 chars after the header
        start = m.end()
        snippet = text[start:start + 500]
        for line in snippet.splitlines():
            clean = line.strip().lstrip("-*•").strip()
            if len(clean) < 25:
                continue
            if clean.startswith("#"):
                break  # hit next section
            if re.search(r'\b(worked|always|avoid|prefer|pattern|lesson)\b', clean, re.IGNORECASE):
                patterns.append({
                    "pattern": clean,
                    "source_commit": "",
                    "files": [],
                    "confidence": "medium",
                })

    # Dedup
    seen: set[str] = set()
    unique: list[dict] = []
    for p in patterns:
        key = p["pattern"][:80]
        if key not in seen:
            seen.add(key)
            unique.append(p)

    return unique


def store_patterns(patterns: list[dict], project_id: str = "soren") -> int:
    """Store extracted patterns in the memory store with source_type='pattern'.

    Deduplication is handled by memory_store (source_path + content_hash).
    Returns count of new patterns actually stored.
    """
    if not patterns:
        return 0

    entries = []
    for p in patterns:
        text = p.get("pattern", "").strip()
        if len(text) < 25:
            continue

        source_commit = p.get("source_commit", "")
        files = p.get("files", [])
        confidence = p.get("confidence", "medium")

        # Build source_path — used for dedup; commit patterns keyed by sha
        if source_commit:
            source_path = f"commit:{source_commit}"
        else:
            source_path = None  # journal patterns dedup by content only

        entries.append({
            "content": text,
            "source_type": "pattern",
            "source_path": source_path,
            "keywords": files[:6],
            "tags": [confidence, "pattern", project_id],
            "project_id": project_id,
        })

    if not entries:
        return 0

    return memory_store.add_memories_batch(entries)
