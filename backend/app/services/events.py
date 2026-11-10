import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from app.domain.models import DomainEvent
from app.infra.bus import EventBus
from app.infra.repositories import EventRepository

# Runs a blocking call off the event loop: asyncio.to_thread, or the app's DbRunner.
RunDb = Callable[..., Awaitable[Any]]


class EventLogWriter:
    """Persists domain events and republishes the stored row as an "event" message."""

    def __init__(self, repo: EventRepository, bus: EventBus, run: RunDb = asyncio.to_thread) -> None:
        self._repo = repo
        self._bus = bus
        self._run = run

    async def handle(self, ev: DomainEvent) -> None:
        stored = await self._run(self._repo.add, ev)
        await self._bus.publish("event", stored)


class EventService:
    def __init__(self, repo: EventRepository, run: RunDb = asyncio.to_thread) -> None:
        self._repo = repo
        self._run = run

    async def list(
        self,
        device_id: int | None = None,
        severity: str | None = None,
        limit: int = 100,
        before_id: int | None = None,
    ) -> list[dict]:
        return await self._run(self._repo.list, device_id, severity, limit, before_id)

    async def ack(self, id: int) -> None:
        await self._run(self._repo.ack, id)

    async def clear(self) -> int:
        return await self._run(self._repo.clear)
