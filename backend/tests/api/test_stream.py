import asyncio

import time
from datetime import UTC, datetime

from fastapi.sse import ServerSentEvent

from app.api.sse import SseBroadcaster, event_stream, to_event
from app.domain.models import DomainEvent, EventKind, Severity
from app.infra.bus import EventBus
from app.infra.db import make_session_factory
from app.infra.repositories import EventRepository
from app.services.events import EventLogWriter


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


def test_to_event_keeps_topic_as_event_name_and_json_payload():
    ev = to_event("status", {"device_id": 1, "since": datetime(2026, 11, 11, tzinfo=UTC)})
    assert isinstance(ev, ServerSentEvent)
    assert ev.event == "status"
    assert ev.raw_data == '{"device_id": 1, "since": "2026-11-11 00:00:00+00:00"}'


async def test_stream_yields_events_for_published_messages():
    b = SseBroadcaster()
    gen = event_stream(b, check_s=0.05)
    first = asyncio.ensure_future(gen.__anext__())
    await asyncio.sleep(0.01)
    await b.handle("status", {"device_id": 1, "status": "UP"})
    ev = await first
    assert (ev.event, ev.raw_data) == ("status", '{"device_id": 1, "status": "UP"}')
    await gen.aclose()
    assert b.clients == set()


async def test_stream_unregisters_when_cancelled_by_disconnect():
    b = SseBroadcaster()
    gen = event_stream(b, check_s=10)
    task = asyncio.ensure_future(gen.__anext__())
    await asyncio.sleep(0.01)
    assert len(b.clients) == 1
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    assert b.clients == set()


async def test_stream_ends_when_client_was_dropped():
    b = SseBroadcaster(max_queue=1)
    gen = event_stream(b, check_s=0.05)
    first = asyncio.ensure_future(gen.__anext__())
    await asyncio.sleep(0.01)
    await b.handle("result", {"i": 0})
    await b.handle("result", {"i": 1})  # overflows -> dropped
    assert (await first).event == "result"
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
        assert r.headers["x-accel-buffering"] == "no"
        client.post("/api/devices", json={"name": "SW1", "host": "10.0.0.2", "enabled": False})
        lines = []
        for line in r.iter_lines():
            lines.append(line)
            if line.startswith("data:"):
                break
    assert lines[0] == "event: status"
    assert '"status": "UNKNOWN"' in lines[1] or '"status": "PAUSED"' in lines[1]


def test_stream_client_is_released_after_disconnect(client):
    broadcaster = client.app.state.container.broadcaster
    with client.stream("GET", "/api/stream") as r:
        assert r.status_code == 200
        assert len(broadcaster.clients) == 1
    deadline = time.monotonic() + 2
    while broadcaster.clients and time.monotonic() < deadline:
        time.sleep(0.02)
    assert broadcaster.clients == set()
