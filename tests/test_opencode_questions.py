"""Tests for services/opencode_questions.py — detecting a pending
opencode `question` tool call directly from opencode's own transcript
(the `part` table), without any new bridge-plugin event pipeline.
"""
import json

import pytest

from src.server.services import opencode_questions


def _make_part_db(path, parts):
    """parts: list of (id, session_id, time_created, data_dict)."""
    import sqlite3

    conn = sqlite3.connect(str(path))
    conn.execute(
        """
        CREATE TABLE part (
            id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT,
            time_created INTEGER, time_updated INTEGER, data TEXT
        )
        """
    )
    conn.executemany(
        "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) "
        "VALUES (?, 'msg1', ?, ?, ?, ?)",
        [(pid, sid, ts, ts, json.dumps(data)) for pid, sid, ts, data in parts],
    )
    conn.commit()
    conn.close()


@pytest.fixture
def fake_db(tmp_path, monkeypatch):
    db_path = tmp_path / "opencode.db"
    monkeypatch.setenv("SOREN_OPENCODE_DB_PATH", str(db_path))
    return db_path


_SAMPLE_INPUT = {
    "questions": [
        {
            "question": "Approve deploy?",
            "header": "Deploy check",
            "options": [
                {"label": "Yes", "description": "Ship it"},
                {"label": "No", "description": "Hold off"},
            ],
        }
    ]
}


def test_returns_none_when_db_missing(fake_db):
    assert opencode_questions.get_pending_question("ses_a") is None


def test_returns_none_for_empty_session_id():
    assert opencode_questions.get_pending_question("") is None
    assert opencode_questions.get_pending_question(None) is None


def test_returns_pending_question_when_running(fake_db):
    _make_part_db(
        fake_db,
        [
            (
                "prt_1", "ses_a", 100,
                {
                    "type": "tool", "tool": "question", "callID": "call_1",
                    "state": {"status": "running", "input": _SAMPLE_INPUT},
                },
            ),
        ],
    )
    result = opencode_questions.get_pending_question("ses_a")
    assert result is not None
    assert result["call_id"] == "call_1"
    assert result["questions"] == _SAMPLE_INPUT["questions"]


@pytest.mark.parametrize("status", ["completed", "error"])
def test_returns_none_for_terminal_states(fake_db, status):
    _make_part_db(
        fake_db,
        [
            (
                "prt_1", "ses_a", 100,
                {
                    "type": "tool", "tool": "question", "callID": "call_1",
                    "state": {"status": status, "input": _SAMPLE_INPUT, "output": "answered"},
                },
            ),
        ],
    )
    assert opencode_questions.get_pending_question("ses_a") is None


def test_ignores_non_question_tool_calls(fake_db):
    _make_part_db(
        fake_db,
        [
            (
                "prt_1", "ses_a", 100,
                {
                    "type": "tool", "tool": "bash", "callID": "call_1",
                    "state": {"status": "running", "input": {"command": "ls"}},
                },
            ),
        ],
    )
    assert opencode_questions.get_pending_question("ses_a") is None


def test_ignores_other_sessions(fake_db):
    _make_part_db(
        fake_db,
        [
            (
                "prt_1", "ses_other", 100,
                {
                    "type": "tool", "tool": "question", "callID": "call_1",
                    "state": {"status": "running", "input": _SAMPLE_INPUT},
                },
            ),
        ],
    )
    assert opencode_questions.get_pending_question("ses_a") is None


def test_uses_most_recent_question_when_multiple_exist(fake_db):
    old_input = {
        "questions": [{"question": "Old question?", "header": "Old", "options": []}]
    }
    _make_part_db(
        fake_db,
        [
            (
                "prt_old", "ses_a", 100,
                {
                    "type": "tool", "tool": "question", "callID": "call_old",
                    "state": {"status": "completed", "input": old_input, "output": "done"},
                },
            ),
            (
                "prt_new", "ses_a", 200,
                {
                    "type": "tool", "tool": "question", "callID": "call_new",
                    "state": {"status": "running", "input": _SAMPLE_INPUT},
                },
            ),
        ],
    )
    result = opencode_questions.get_pending_question("ses_a")
    assert result["call_id"] == "call_new"


def test_returns_none_when_most_recent_question_already_resolved(fake_db):
    """If the LATEST question tool call for this session has already
    completed, even if an OLDER one in the same session was never
    resolved (shouldn't normally happen since the tool blocks the agent
    entirely), only the latest matters -- an agent can't have two
    genuinely concurrent pending questions in one session."""
    _make_part_db(
        fake_db,
        [
            (
                "prt_new", "ses_a", 200,
                {
                    "type": "tool", "tool": "question", "callID": "call_new",
                    "state": {"status": "completed", "input": _SAMPLE_INPUT, "output": "done"},
                },
            ),
        ],
    )
    assert opencode_questions.get_pending_question("ses_a") is None


def test_returns_none_for_malformed_part_data(fake_db):
    import sqlite3

    conn = sqlite3.connect(str(fake_db))
    conn.execute(
        "CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, "
        "time_created INTEGER, time_updated INTEGER, data TEXT)"
    )
    conn.execute(
        "INSERT INTO part VALUES ('prt_1', 'msg1', 'ses_a', 100, 100, 'not valid json')"
    )
    conn.commit()
    conn.close()
    assert opencode_questions.get_pending_question("ses_a") is None


def test_returns_none_when_running_but_no_questions_present(fake_db):
    _make_part_db(
        fake_db,
        [
            (
                "prt_1", "ses_a", 100,
                {
                    "type": "tool", "tool": "question", "callID": "call_1",
                    "state": {"status": "running", "input": {"questions": []}},
                },
            ),
        ],
    )
    assert opencode_questions.get_pending_question("ses_a") is None
