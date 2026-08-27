"""Generate a post-mortem PDF report for a reverted or failed commit."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

import requests
from fpdf import FPDF


# ── Helpers ──────────────────────────────────────────────────────────────────

def _sanitize(text: str) -> str:
    """Replace unicode chars that fpdf2 can't render in latin-1."""
    replacements = {
        "\u2014": "--",   # em dash
        "\u2013": "-",    # en dash
        "\u2018": "'",    # left single quote
        "\u2019": "'",    # right single quote
        "\u201c": '"',    # left double quote
        "\u201d": '"',    # right double quote
        "\u2026": "...",  # ellipsis
        "\u2192": "->",   # right arrow
        "\u2190": "<-",   # left arrow
        "\u2194": "<->",  # left-right arrow
        "\u2022": "*",    # bullet
        "\u00b7": "*",    # middle dot
        "\u2713": "[x]",  # check mark
        "\u2717": "[ ]",  # cross mark
        "\u00a0": " ",    # non-breaking space
        "\u200b": "",     # zero-width space
        "\u2502": "|",    # box drawing vertical
        "\u251c": "|",    # box drawing tee
        "\u2514": "`",    # box drawing corner
        "\u2500": "-",    # box drawing horizontal
    }
    for orig, repl in replacements.items():
        text = text.replace(orig, repl)
    # Fallback: encode to latin-1, replace anything else
    return text.encode("latin-1", errors="replace").decode("latin-1")


def _git(args: list[str], cwd: str | None = None) -> str:
    """Run a git command and return stdout."""
    result = subprocess.run(
        ["git"] + args,
        capture_output=True, text=True, cwd=cwd,
    )
    return result.stdout.strip()


def _git_rc(args: list[str], cwd: str | None = None) -> tuple[int, str]:
    """Run a git command and return (returncode, stdout)."""
    result = subprocess.run(
        ["git"] + args,
        capture_output=True, text=True, cwd=cwd,
    )
    return result.returncode, result.stdout.strip()


# ── Data extraction ──────────────────────────────────────────────────────────

def get_commit_info(commit_hash: str) -> dict:
    """Extract commit metadata from git."""
    fmt = "%H%n%h%n%an%n%ae%n%ai%n%s%n%b"
    raw = _git(["log", "-1", f"--format={fmt}", commit_hash])
    lines = raw.split("\n")
    if len(lines) < 6:
        print(f"error: could not find commit {commit_hash}", file=sys.stderr)
        sys.exit(1)
    return {
        "full_hash": lines[0],
        "short_hash": lines[1],
        "author": lines[2],
        "email": lines[3],
        "date": lines[4],
        "subject": lines[5],
        "body": "\n".join(lines[6:]).strip(),
    }


def get_commit_diff(commit_hash: str) -> str:
    """Get the diff for a commit."""
    return _git(["diff", f"{commit_hash}~1..{commit_hash}", "--stat"])


def get_commit_full_diff(commit_hash: str) -> str:
    """Get the full patch diff for a commit."""
    return _git(["diff", f"{commit_hash}~1..{commit_hash}"])


def get_files_changed(commit_hash: str) -> list[str]:
    """Get list of files changed in a commit."""
    raw = _git(["diff-tree", "--no-commit-id", "--name-only", "-r", commit_hash])
    return [f for f in raw.split("\n") if f]


def find_revert_commit(short_hash: str, subject: str = "") -> dict | None:
    """Find a revert commit for the given hash or subject."""
    # Strategy 1: grep for hash in revert commits
    raw = _git(["log", "--all", f"--grep=Revert.*{short_hash}", "--format=%H %s", "-1"])
    if raw:
        parts = raw.split(" ", 1)
        return {"hash": parts[0], "subject": parts[1] if len(parts) > 1 else ""}

    # Strategy 2: grep for the original commit subject in revert messages
    if subject:
        raw = _git(["log", "--all", f"--grep=Revert.*{subject[:60]}", "--format=%H %s", "-1"])
        if raw:
            parts = raw.split(" ", 1)
            return {"hash": parts[0], "subject": parts[1] if len(parts) > 1 else ""}

    # Strategy 3: check if the next commit is a revert (common pattern)
    raw = _git(["log", "--all", "--grep=Revert", "--format=%H %s", "-10"])
    if raw:
        for line in raw.split("\n"):
            if short_hash in line or (subject and subject[:40] in line):
                parts = line.split(" ", 1)
                return {"hash": parts[0], "subject": parts[1] if len(parts) > 1 else ""}

    return None


def query_agent_events(commit_date: str, api_port: int = 8000) -> list[dict]:
    """Query agent events API for events around the commit timestamp."""
    try:
        resp = requests.get(
            f"http://localhost:{api_port}/api/agent-events",
            params={"limit": 100},
            timeout=5,
        )
        if not resp.ok:
            return []
        events = resp.json().get("events", [])

        # Parse commit date and create a window (30 min before and after)
        try:
            # git date format: 2026-02-28 14:30:00 +0530
            commit_dt = datetime.fromisoformat(commit_date.replace(" +", "+").replace(" -", "-"))
        except Exception:
            return events[:20]  # Can't parse, return recent

        window_start = commit_dt - timedelta(minutes=30)
        window_end = commit_dt + timedelta(minutes=30)

        matched = []
        for ev in events:
            try:
                ev_time = datetime.fromisoformat(ev["timestamp"].replace("Z", "+00:00"))
                # Compare naive if needed
                if ev_time.tzinfo and not window_start.tzinfo:
                    ev_time = ev_time.replace(tzinfo=None)
                elif window_start.tzinfo and not ev_time.tzinfo:
                    window_start = window_start.replace(tzinfo=None)
                    window_end = window_end.replace(tzinfo=None)
                if window_start <= ev_time <= window_end:
                    matched.append(ev)
            except Exception:
                continue
        return matched if matched else events[:10]
    except Exception:
        return []


# ── PDF generation ───────────────────────────────────────────────────────────

class PostmortemPDF(FPDF):
    """Custom PDF for post-mortem reports."""

    def header(self):
        self.set_font("Helvetica", "B", 14)
        self.cell(0, 10, _sanitize("SOREN Post-Mortem Report"), new_x="LMARGIN", new_y="NEXT", align="C")
        self.ln(2)

    def footer(self):
        self.set_y(-15)
        self.set_font("Helvetica", "I", 8)
        self.cell(0, 10, f"Page {self.page_no()}/{{nb}}", align="C")

    def section_title(self, title: str):
        self.set_font("Helvetica", "B", 12)
        self.set_fill_color(230, 230, 230)
        self.cell(0, 8, _sanitize(title), new_x="LMARGIN", new_y="NEXT", fill=True)
        self.ln(2)

    def section_body(self, text: str):
        self.set_font("Courier", "", 8)
        for line in _sanitize(text).split("\n"):
            # Truncate very long lines
            if len(line) > 120:
                line = line[:117] + "..."
            self.cell(0, 4, line, new_x="LMARGIN", new_y="NEXT")
        self.ln(2)

    def key_value(self, key: str, value: str):
        self.set_font("Helvetica", "B", 10)
        self.cell(40, 6, _sanitize(key + ":"))
        self.set_font("Helvetica", "", 10)
        self.multi_cell(0, 6, _sanitize(value))
        self.ln(1)


def generate_pdf(commit_hash: str, output_path: str, api_port: int = 8000) -> str:
    """Generate a post-mortem PDF for the given commit hash."""
    # Gather data
    info = get_commit_info(commit_hash)
    diff_stat = get_commit_diff(commit_hash)
    full_diff = get_commit_full_diff(commit_hash)
    files = get_files_changed(commit_hash)
    revert = find_revert_commit(info["short_hash"], info["subject"])
    events = query_agent_events(info["date"], api_port)

    # Build PDF
    pdf = PostmortemPDF()
    pdf.alias_nb_pages()
    pdf.add_page()
    pdf.set_auto_page_break(auto=True, margin=15)

    # ── Summary ──
    pdf.section_title("1. Commit Summary")
    pdf.key_value("Commit", f"{info['short_hash']} ({info['full_hash']})")
    pdf.key_value("Author", f"{info['author']} <{info['email']}>")
    pdf.key_value("Date", info["date"])
    pdf.key_value("Subject", info["subject"])
    if info["body"]:
        pdf.key_value("Body", info["body"])
    pdf.key_value("Files Changed", str(len(files)))

    # ── Revert info ──
    pdf.section_title("2. Revert Status")
    if revert:
        pdf.key_value("Revert Commit", revert["hash"][:12])
        pdf.key_value("Revert Subject", revert["subject"])
    else:
        pdf.set_font("Helvetica", "", 10)
        pdf.cell(0, 6, "No revert commit found for this hash.", new_x="LMARGIN", new_y="NEXT")
        pdf.ln(2)

    # ── Files changed ──
    pdf.section_title("3. Files Changed")
    pdf.section_body(diff_stat if diff_stat else "(no diff stat available)")

    # ── Agent activity ──
    pdf.section_title("4. Agent Activity (around commit time)")
    if events:
        for ev in events[:15]:
            agent = ev.get("agent_id", "unknown")
            etype = ev.get("event_type", "?")
            tool = ev.get("tool_name", "")
            ts = ev.get("timestamp", "")[:19]
            line = f"[{ts}] {agent} | {etype}"
            if tool:
                line += f" | {tool}"
            pdf.set_font("Courier", "", 8)
            pdf.cell(0, 4, _sanitize(line), new_x="LMARGIN", new_y="NEXT")

            # Show tool input summary if available
            tool_input = ev.get("tool_input")
            if tool_input and isinstance(tool_input, (str, dict)):
                inp = str(tool_input)[:100]
                pdf.set_font("Courier", "", 7)
                pdf.cell(0, 3, _sanitize(f"  input: {inp}"), new_x="LMARGIN", new_y="NEXT")
        pdf.ln(2)
    else:
        pdf.set_font("Helvetica", "", 10)
        pdf.cell(0, 6, "No agent events found in the time window.", new_x="LMARGIN", new_y="NEXT")
        pdf.ln(2)

    # ── Full diff (truncated) ──
    pdf.section_title("5. Diff (truncated)")
    diff_lines = full_diff.split("\n")
    max_diff_lines = 80
    truncated = diff_lines[:max_diff_lines]
    diff_text = "\n".join(truncated)
    if len(diff_lines) > max_diff_lines:
        diff_text += f"\n\n... ({len(diff_lines) - max_diff_lines} more lines truncated)"
    pdf.section_body(diff_text if diff_text.strip() else "(no diff available)")

    # ── Root cause analysis ──
    pdf.section_title("6. Root Cause Analysis")
    pdf.set_font("Helvetica", "", 10)
    rca_lines = [
        "Category: [bug / regression / config error / dependency / design flaw]",
        "",
        "Root Cause:",
        "  (Fill in: what specifically went wrong)",
        "",
        "Contributing Factors:",
        "  (Fill in: what conditions allowed this to happen)",
        "",
        "Impact:",
        f"  Files affected: {len(files)}",
        f"  Reverted: {'Yes' if revert else 'No'}",
        "",
        "Prevention:",
        "  (Fill in: what changes would prevent recurrence)",
    ]
    for line in rca_lines:
        pdf.cell(0, 5, _sanitize(line), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)

    # ── Timeline ──
    pdf.section_title("7. Chronological Timeline")
    timeline = []
    timeline.append(f"{info['date'][:19]}  Commit created: {info['subject']}")
    if events:
        for ev in events[:10]:
            ts = ev.get("timestamp", "")[:19]
            agent = ev.get("agent_id", "?")
            tool = ev.get("tool_name", "")
            etype = ev.get("event_type", "?")
            desc = f"{agent} {etype}"
            if tool:
                desc += f" ({tool})"
            timeline.append(f"{ts}  {desc}")
    if revert:
        revert_info = get_commit_info(revert["hash"])
        timeline.append(f"{revert_info['date'][:19]}  REVERTED: {revert['subject']}")
    timeline.sort()
    pdf.section_body("\n".join(timeline) if timeline else "(no timeline data)")

    # Write PDF
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    pdf.output(output_path)
    return output_path


# ── CLI ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Generate post-mortem PDF for a commit")
    parser.add_argument("commit", help="Commit hash to analyze")
    parser.add_argument("--output", "-o", help="Output PDF path (default: auto)")
    parser.add_argument("--port", type=int, default=8000, help="SOREN API port")
    args = parser.parse_args()

    # Resolve full hash
    rc, full_hash = _git_rc(["rev-parse", args.commit])
    if rc != 0:
        print(f"error: invalid commit hash: {args.commit}", file=sys.stderr)
        sys.exit(1)

    short_hash = _git(["rev-parse", "--short", full_hash])

    # Default output path
    if args.output:
        output_path = args.output
    else:
        today = datetime.now().strftime("%Y-%m-%d")
        repo_root = _git(["rev-parse", "--show-toplevel"])
        # Post-mortems are supervisor-level governance, not team-scoped.
        output_path = os.path.join(
            repo_root, ".soren", "journal", "supervisor", today, "artifacts",
            f"postmortem-{short_hash}.pdf",
        )

    print(f"Generating post-mortem for {short_hash} ({full_hash[:12]}...)...")
    result = generate_pdf(full_hash, output_path, args.port)
    print(f"PDF saved: {result}")


if __name__ == "__main__":
    main()
