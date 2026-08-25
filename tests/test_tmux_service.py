"""Regression tests for the message-delivery fortification pass.

Covers the bugs found in an end-to-end audit of the outbound message path
(dashboard -> mailbox/tmux -> agent): TmuxService previously never checked
whether the target tmux window existed, never checked the underlying tmux
commands' exit codes, and had no concurrency protection for two sends
racing the same window.
"""
import asyncio

import pytest

from src.server.services.tmux_service import TmuxService, TmuxDeliveryError


@pytest.mark.asyncio
async def test_send_input_raises_when_window_does_not_exist(monkeypatch):
    """Sending to a window that doesn't exist (agent asleep/crashed/never
    spawned) must raise, not silently succeed. This is the exact bug that
    let a dashboard message to a sleeping agent return HTTP 200 while
    never reaching anything."""
    svc = TmuxService()
    monkeypatch.setattr(svc, "window_exists", lambda window, session=None: _async_false())

    calls = []

    async def fake_run_command(cmd):
        calls.append(cmd)
        return "", "", 0

    monkeypatch.setattr(svc, "_run_command", fake_run_command)

    with pytest.raises(TmuxDeliveryError, match="does not exist"):
        await svc.send_input("dead-window", "hello")

    # Must never have attempted any tmux send-keys call for a window that
    # doesn't exist.
    assert calls == []


@pytest.mark.asyncio
async def test_send_input_raises_when_send_keys_fails(monkeypatch):
    """Even when the window exists, an underlying tmux command failure
    (nonzero exit) must be surfaced, not silently discarded."""
    svc = TmuxService()
    monkeypatch.setattr(svc, "window_exists", lambda window, session=None: _async_true())

    async def fake_run_command(cmd):
        if cmd[:2] == ["tmux", "send-keys"] and "-l" in cmd:
            return "", "no such window", 1
        return "", "", 0

    monkeypatch.setattr(svc, "_run_command", fake_run_command)

    with pytest.raises(TmuxDeliveryError, match="send-keys failed"):
        await svc.send_input("flaky-window", "hello")


@pytest.mark.asyncio
async def test_send_input_succeeds_and_sends_enter_separately(monkeypatch):
    """Happy path: window exists, all tmux commands succeed."""
    svc = TmuxService()
    monkeypatch.setattr(svc, "window_exists", lambda window, session=None: _async_true())

    calls = []

    async def fake_run_command(cmd):
        calls.append(cmd)
        return "", "", 0

    monkeypatch.setattr(svc, "_run_command", fake_run_command)

    await svc.send_input("good-window", "hello world", session="soren")

    # Text sent literally, then Enter sent as a separate command.
    assert any(c[:4] == ["tmux", "send-keys", "-t", "soren:good-window"] and "-l" in c for c in calls)
    assert any(c == ["tmux", "send-keys", "-t", "soren:good-window", "Enter"] for c in calls)


@pytest.mark.asyncio
async def test_send_input_raises_when_enter_fails(monkeypatch):
    """The text injection can succeed while the separate Enter command
    fails — that must still be surfaced as a delivery failure, since the
    agent never actually receives a submitted message."""
    svc = TmuxService()
    monkeypatch.setattr(svc, "window_exists", lambda window, session=None: _async_true())

    async def fake_run_command(cmd):
        if cmd[-1] == "Enter":
            return "", "pane died", 1
        return "", "", 0

    monkeypatch.setattr(svc, "_run_command", fake_run_command)

    with pytest.raises(TmuxDeliveryError, match="Enter failed"):
        await svc.send_input("window", "hello")


@pytest.mark.asyncio
async def test_concurrent_sends_to_same_window_are_serialized(monkeypatch):
    """Two concurrent sends to the SAME window must not interleave their
    underlying tmux calls — previously there was no locking at all, so
    two overlapping asyncio tasks could garble each other's keystrokes.
    We simulate this by making each tmux call yield control (asyncio.sleep)
    and recording the order of (message, call) pairs; with the per-window
    lock in place, all of message A's calls must appear before any of
    message B's, or vice versa — never interleaved.
    """
    svc = TmuxService()
    monkeypatch.setattr(svc, "window_exists", lambda window, session=None: _async_true())

    order = []

    async def fake_run_command(cmd):
        # Yield control so a real race would have a chance to interleave.
        await asyncio.sleep(0.01)
        order.append(tuple(cmd))
        return "", "", 0

    monkeypatch.setattr(svc, "_run_command", fake_run_command)

    await asyncio.gather(
        svc.send_input("shared-window", "message-A"),
        svc.send_input("shared-window", "message-B"),
    )

    # Each send does exactly 2 tmux calls: send-keys -l <text>, then a
    # separate send-keys Enter. Without the per-window lock, these could
    # interleave as [A-text, B-text, A-enter, B-enter] (or worse), which
    # would submit a mix of both messages' text under one Enter press.
    # With the lock, one message's full pair must complete before the
    # other's starts: either [A-text, A-enter, B-text, B-enter] or the
    # same with A/B swapped — never interleaved.
    assert len(order) == 4
    is_text_call = ["-l" in c for c in order]
    is_enter_call = [c[-1] == "Enter" for c in order]
    assert is_text_call == [True, False, True, False]
    assert is_enter_call == [False, True, False, True]
    # And each text call's message must match the very next Enter call's
    # target window (trivially true here since there's only one window,
    # but the pairing-not-interleaving property is the actual invariant).
    first_message = "message-A" if "message-A" in order[0] else "message-B"
    second_message = "message-B" if first_message == "message-A" else "message-A"
    assert first_message in order[0]
    assert second_message in order[2]


async def _async_true():
    return True


async def _async_false():
    return False


@pytest.mark.asyncio
async def test_send_interrupt_raises_when_window_does_not_exist(monkeypatch):
    """interrupt_agent's whole point is stopping a runaway agent — if the
    window is already gone, the caller needs to know nothing happened,
    not get a false {"success": true}."""
    svc = TmuxService()
    monkeypatch.setattr(svc, "window_exists", lambda window, session=None: _async_false())

    with pytest.raises(TmuxDeliveryError, match="does not exist"):
        await svc.send_interrupt("dead-window")


@pytest.mark.asyncio
async def test_send_interrupt_raises_when_tmux_command_fails(monkeypatch):
    svc = TmuxService()
    monkeypatch.setattr(svc, "window_exists", lambda window, session=None: _async_true())

    async def fake_run_command(cmd):
        return "", "pane gone", 1

    monkeypatch.setattr(svc, "_run_command", fake_run_command)

    with pytest.raises(TmuxDeliveryError, match="C-c failed"):
        await svc.send_interrupt("window")


@pytest.mark.asyncio
async def test_send_interrupt_succeeds(monkeypatch):
    svc = TmuxService()
    monkeypatch.setattr(svc, "window_exists", lambda window, session=None: _async_true())

    calls = []

    async def fake_run_command(cmd):
        calls.append(cmd)
        return "", "", 0

    monkeypatch.setattr(svc, "_run_command", fake_run_command)

    await svc.send_interrupt("window", session="soren")
    assert calls == [["tmux", "send-keys", "-t", "soren:window", "C-c"]]
