import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Request
from fastapi.sse import EventSourceResponse, ServerSentEvent

# How often an idle stream checks whether it was dropped as a slow client.
# Keep-alive pings, no-cache headers and disconnect handling come from FastAPI.
DROP_CHECK_S = 15.0


class SseBroadcaster:
    def __init__(self, max_queue: int = 1000) -> None:
        self._max_queue = max_queue
        self.clients: set[asyncio.Queue] = set()

    def register(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=self._max_queue)
        self.clients.add(q)
        return q

    def unregister(self, q: asyncio.Queue) -> None:
        self.clients.discard(q)

    async def handle(self, topic: str, payload: Any) -> None:
        for q in list(self.clients):
            try:
                q.put_nowait((topic, payload))
            except asyncio.QueueFull:
                self.unregister(q)  # too slow; the browser reconnects and reloads /status


def to_event(topic: str, payload: Any) -> ServerSentEvent:
    # raw_data keeps our own JSON encoding (datetimes via str) instead of FastAPI's.
    return ServerSentEvent(event=topic, raw_data=json.dumps(payload, default=str))


async def event_stream(
    broadcaster: SseBroadcaster, check_s: float = DROP_CHECK_S
) -> AsyncIterator[ServerSentEvent]:
    q = broadcaster.register()
    try:
        while True:
            try:
                topic, payload = await asyncio.wait_for(q.get(), timeout=check_s)
            except TimeoutError:
                if q not in broadcaster.clients:
                    return  # dropped as a slow client; end so the browser reconnects
                continue
            yield to_event(topic, payload)
            if q not in broadcaster.clients and q.empty():
                return
    finally:
        broadcaster.unregister(q)


router = APIRouter()


@router.get("/stream", response_class=EventSourceResponse)
async def stream(request: Request) -> AsyncIterator[ServerSentEvent]:
    broadcaster: SseBroadcaster = request.app.state.container.broadcaster
    async for event in event_stream(broadcaster):
        yield event
