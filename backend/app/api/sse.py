import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

HEARTBEAT_S = 15.0


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


def format_sse(topic: str, payload: Any) -> str:
    return f"event: {topic}\ndata: {json.dumps(payload, default=str)}\n\n"


async def event_stream(
    broadcaster: SseBroadcaster, request: Request, heartbeat_s: float = HEARTBEAT_S
) -> AsyncIterator[str]:
    q = broadcaster.register()
    try:
        while not await request.is_disconnected():
            try:
                topic, payload = await asyncio.wait_for(q.get(), timeout=heartbeat_s)
            except TimeoutError:
                if q not in broadcaster.clients:
                    return  # dropped as a slow client; end so the browser reconnects
                yield ": ping\n\n"
                continue
            yield format_sse(topic, payload)
            if q not in broadcaster.clients and q.empty():
                return
    finally:
        broadcaster.unregister(q)


router = APIRouter()


@router.get("/stream")
async def stream(request: Request) -> StreamingResponse:
    broadcaster: SseBroadcaster = request.app.state.container.broadcaster
    return StreamingResponse(
        event_stream(broadcaster, request),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
