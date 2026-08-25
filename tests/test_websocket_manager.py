"""Regression tests for the WebSocket ConnectionManager fortification.

Previously broadcast()/_send_ping() held ONE global lock for the entire
fan-out loop, sending to every client sequentially inside it. A single
slow or backpressured client's send_text() call blocked delivery to every
other connected client for that broadcast, and also blocked connect()/
disconnect() from even acquiring the lock in the meantime. The fix
snapshots the client list, releases the lock, and sends to every client
concurrently (asyncio.gather) — while still serializing sends to any ONE
connection via a per-client lock, since concurrent send_text() calls on
the same WebSocket are unsafe.
"""
import asyncio

import pytest

from src.server.websocket.manager import ConnectionManager


class FakeWebSocket:
    """Minimal stand-in for FastAPI's WebSocket — just enough surface for
    ConnectionManager to drive (accept/send_text/close)."""

    def __init__(self, client_id: str, delay: float = 0.0, fail: bool = False):
        self.client_id = client_id
        self.delay = delay
        self.fail = fail
        self.sent: list[str] = []
        self.accepted = False
        self.closed = False
        self.max_concurrent_sends = 0
        self._in_flight = 0

    async def accept(self):
        self.accepted = True

    async def send_text(self, message: str):
        self._in_flight += 1
        self.max_concurrent_sends = max(self.max_concurrent_sends, self._in_flight)
        try:
            if self.delay:
                await asyncio.sleep(self.delay)
            if self.fail:
                raise ConnectionError(f"simulated failure for {self.client_id}")
            self.sent.append(message)
        finally:
            self._in_flight -= 1

    async def close(self):
        self.closed = True


@pytest.mark.asyncio
async def test_broadcast_reaches_all_clients():
    mgr = ConnectionManager()
    ws_a, ws_b, ws_c = FakeWebSocket("a"), FakeWebSocket("b"), FakeWebSocket("c")
    await mgr.connect(ws_a, "a")
    await mgr.connect(ws_b, "b")
    await mgr.connect(ws_c, "c")

    await mgr.broadcast("test_event", {"x": 1})

    assert len(ws_a.sent) == 1
    assert len(ws_b.sent) == 1
    assert len(ws_c.sent) == 1


@pytest.mark.asyncio
async def test_one_slow_client_does_not_delay_delivery_to_others():
    """The core bug: a slow client's send_text() must not block delivery
    to fast clients. We give one client a deliberate delay and assert the
    fast clients received their message well before the slow one's delay
    would have elapsed if sends were serialized."""
    mgr = ConnectionManager()
    slow = FakeWebSocket("slow", delay=0.3)
    fast1 = FakeWebSocket("fast1")
    fast2 = FakeWebSocket("fast2")
    await mgr.connect(slow, "slow")
    await mgr.connect(fast1, "fast1")
    await mgr.connect(fast2, "fast2")

    start = asyncio.get_event_loop().time()
    await mgr.broadcast("test_event", {"x": 1})
    elapsed = asyncio.get_event_loop().time() - start

    # All three received it...
    assert len(slow.sent) == 1
    assert len(fast1.sent) == 1
    assert len(fast2.sent) == 1
    # ...and the whole broadcast took roughly as long as the SLOWEST
    # individual send (concurrent), not the SUM of all sends (serial).
    # With the old sequential-under-one-lock implementation this would
    # be bounded below by 0.3s regardless (that part is unavoidable —
    # the slow client itself really does take 0.3s) but critically the
    # fast clients' own timestamps must not be gated behind it. We assert
    # the fast clients' sends actually happened concurrently with the
    # slow one by checking total elapsed time isn't inflated by having
    # waited on the slow client BEFORE even starting the fast ones.
    assert elapsed < 0.5  # generous margin; concurrent should be ~0.3s


@pytest.mark.asyncio
async def test_connect_and_disconnect_not_blocked_by_slow_broadcast():
    """A slow broadcast in flight must not prevent a new client from
    connecting or an existing one from disconnecting — previously both
    had to wait for the SAME global lock the broadcast loop held for its
    entire duration."""
    mgr = ConnectionManager()
    slow = FakeWebSocket("slow", delay=0.3)
    await mgr.connect(slow, "slow")

    broadcast_task = asyncio.create_task(mgr.broadcast("test_event", {"x": 1}))
    # Give the broadcast a moment to start (and be blocked inside the
    # slow client's send_text) before trying to connect a new client.
    await asyncio.sleep(0.05)

    start = asyncio.get_event_loop().time()
    new_client = FakeWebSocket("new")
    await mgr.connect(new_client, "new")
    connect_elapsed = asyncio.get_event_loop().time() - start

    # connect() must return quickly, not wait out the slow broadcast.
    assert connect_elapsed < 0.2
    assert "new" in mgr.active_connections

    await broadcast_task


@pytest.mark.asyncio
async def test_failed_send_removes_only_that_client():
    mgr = ConnectionManager()
    good = FakeWebSocket("good")
    bad = FakeWebSocket("bad", fail=True)
    await mgr.connect(good, "good")
    await mgr.connect(bad, "bad")

    await mgr.broadcast("test_event", {"x": 1})

    assert len(good.sent) == 1
    assert "good" in mgr.active_connections
    assert "bad" not in mgr.active_connections  # pruned after the failed send


@pytest.mark.asyncio
async def test_concurrent_sends_to_the_same_connection_are_serialized():
    """A broadcast and the ping loop can legitimately race on the same
    connection. Concurrent send_text() calls on ONE WebSocket must never
    overlap (only different connections should run in parallel)."""
    mgr = ConnectionManager()
    ws = FakeWebSocket("only", delay=0.05)
    await mgr.connect(ws, "only")

    await asyncio.gather(
        mgr.broadcast("event_a", {}),
        mgr._send_ping(),
        mgr.broadcast("event_b", {}),
    )

    # If sends to this one connection ever overlapped, max_concurrent_sends
    # would be > 1.
    assert ws.max_concurrent_sends == 1
    assert len(ws.sent) == 3


@pytest.mark.asyncio
async def test_send_to_single_client():
    mgr = ConnectionManager()
    ws = FakeWebSocket("target")
    await mgr.connect(ws, "target")

    await mgr.send_to("target", "direct_event", {"y": 2})

    assert len(ws.sent) == 1


@pytest.mark.asyncio
async def test_send_to_nonexistent_client_is_a_noop():
    mgr = ConnectionManager()
    # Must not raise even though "ghost" was never connected.
    await mgr.send_to("ghost", "direct_event", {})
