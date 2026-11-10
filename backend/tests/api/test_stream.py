import asyncio

from app.api.sse import SseBroadcaster, event_stream, format_sse
from app.domain.models import DomainEvent, EventKind, Severity
from app.infra.bus import EventBus
from app.infra.db import make_session_factory
from app.infra.repositories import EventRepository
from app.services.events import EventLogWriter


class FakeRequest:
    def __init__(self):
        self.disconnected = False

    async def is_disconnected(self):
        return self.disconnected


async def test_broadcaster_drops_slow_client():
    b = SseBroadcaster(max_queue=2)
    q = b.register()
    fast = b.register()
    for i in range(3):
        await b.handle("result", {"i": i})
        fast.get_nowait() if not fast.empty() else None
    assert q not in b.clients and fast in b.clients


async def test_broadcaster_delivers_topic_and_payload():
    b = SseBroadcaster()
    q = b.register()
    await b.handle("status", {"a": 1})
    assert q.get_nowait() == ("status", {"a": 1})
    b.unregister(q)
    await b.handle("status", {"a": 2})
    assert q.empty()


def test_format_is_sse_message():
    assert format_sse("status", {"device_id": 1}) == 'event: status\ndata: {"device_id": 1}\n\n'


async def test_stream_formats_sse_messages_and_heartbeat():
    b = SseBroadcaster()
    req = FakeRequest()
    gen = event_stream(b, req, heartbeat_s=0.05)
    first = asyncio.ensure_future(gen.__anext__())
    await asyncio.sleep(0.01)
    await b.handle("status", {"device_id": 1, "status": "UP"})
    assert await first == 'event: status\ndata: {"device_id": 1, "status": "UP"}\n\n'
    assert await gen.__anext__() == ": ping\n\n"
    req.disconnected = True
    await b.handle("result", {})
    try:
        await asyncio.wait_for(gen.__anext__(), 1)
    except StopAsyncIteration:
        pass
    assert b.clients == set()


async def test_stream_ends_when_client_was_dropped():
    b = SseBroadcaster(max_queue=1)
    gen = event_stream(b, FakeRequest(), heartbeat_s=0.05)
    first = asyncio.ensure_future(gen.__anext__())
    await asyncio.sleep(0.01)
    await b.handle("result", {"i": 0})
    await b.handle("result", {"i": 1})  # overflows -> dropped
    assert (await first).startswith("event: result")
    chunks = [c async for c in gen]
    assert chunks == []
    assert b.clients == set()


async def test_event_log_writer_persists_then_publishes_stored_dict(tmp_path):
    sf = make_session_factory(tmp_path / "e.db")
    try:
        bus = EventBus()
        seen = []

        async def collect(p):
            seen.append(p)

        bus.subscribe("event", collect)
        writer = EventLogWriter(EventRepository(sf), bus)
        bus.subscribe("domain_event", writer.handle)
        await bus.publish(
            "domain_event",
            DomainEvent(None, Severity.WARNING, EventKind.CHECK_ERROR, "boom"),
        )
        assert len(seen) == 1 and seen[0]["id"] == 1 and seen[0]["message"] == "boom"
        assert EventRepository(sf).list()[0]["id"] == 1
    finally:
        sf.kw["bind"].dispose()


def test_stream_endpoint_sends_sse_headers_and_status_message(client):
    with client.stream("GET", "/api/stream") as r:
        assert r.headers["content-type"].startswith("text/event-stream")
        assert r.headers["cache-control"] == "no-cache"
        client.post("/api/devices", json={"name": "SW1", "host": "10.0.0.2", "enabled": False})
        lines = []
        for line in r.iter_lines():
            lines.append(line)
            if line.startswith("data:"):
                break
    assert lines[0] == "event: status"
    assert '"status": "UNKNOWN"' in lines[1] or '"status": "PAUSED"' in lines[1]
