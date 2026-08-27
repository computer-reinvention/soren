"""Detect pending opencode `question` tool calls straight from opencode's
own session transcripts — the same "pull real data from the transcript"
pattern opencode_transcripts.py already uses for cost, applied to the
`question` tool's live state instead.

Why this exists: opencode's built-in `question` tool (a structured
multiple-choice prompt the agent can ask the human) blocks synchronously
in the agent's own TUI until answered. Because the soren-bridge plugin
only fires an event *after* a tool completes, SOREN's own event pipeline
never sees a question while it's still pending — by the time an
agent_events row exists for it, it's already been answered by whoever
happened to be watching the terminal. For an autonomous agent with nobody
at the keyboard, that's nobody, and the question (and whatever decision
it was blocking on) just sits there.

Rather than teach the bridge plugin to push a new "pending" event (a
bigger, riskier change — new event type, new WebSocket message, a second
code path for the exact same data), this reads the pending state directly
from the SAME `part` table in opencode's own database that already holds
the question's full input once it lands — while it's running, the row
already exists with `state.status == "running"` and the question/options
already populated, just without an answer yet. Polling this table on
demand needs no new plugin code and no new event type.

Answering is symmetric and equally simple: opencode's TUI accepts a
selected option's label typed as a normal chat message while a question
is pending (confirmed empirically — the exact same tmux/HTTP prompt-send
path used for every other message works here too), so responding to a
pending question reuses the existing "send a message to this agent"
endpoint verbatim. No new answer-delivery mechanism, no
`/tui/control/response` proxy.
"""
import json
import logging
from typing import Optional

from . import opencode_transcripts

logger = logging.getLogger(__name__)


def get_pending_question(session_id: str) -> Optional[dict]:
    """The most recent `question` tool call in this session, if it's
    still genuinely waiting for an answer.

    Returns None if there's no question tool call at all, the most
    recent one has already finished (state.status is "completed" or
    "error" — including one answered a moment ago via the terminal), the
    session doesn't exist, or opencode's database is unreachable. Every
    case is treated the same way by callers: nothing to show right now.
    """
    if not session_id:
        return None
    conn = opencode_transcripts.connect()
    if conn is None:
        return None
    try:
        row = conn.execute(
            """
            SELECT data FROM part
            WHERE session_id = ?
              AND json_extract(data, '$.type') = 'tool'
              AND json_extract(data, '$.tool') = 'question'
            ORDER BY time_created DESC
            LIMIT 1
            """,
            (session_id,),
        ).fetchone()
    except Exception:
        logger.warning("Query for pending question failed", exc_info=True)
        return None
    finally:
        conn.close()

    if row is None:
        return None
    try:
        part = json.loads(row["data"])
    except (json.JSONDecodeError, TypeError):
        return None

    state = part.get("state") or {}
    if state.get("status") != "running":
        return None

    questions = ((state.get("input") or {}).get("questions")) or []
    if not questions:
        return None

    return {
        "call_id": part.get("callID"),
        "questions": questions,
    }
