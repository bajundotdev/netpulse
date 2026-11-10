import asyncio

from app.domain.models import DomainEvent
from app.infra.bus import EventBus
from app.infra.repositories import EventRepository


class EventLogWriter:
    """Persists domain events and republishes the stored row as an "event" message."""

    def __init__(self, repo: EventRepository, bus: EventBus) -> None:
        self._repo = repo
        self._bus = bus

    async def handle(self, ev: DomainEvent) -> None:
        stored = await asyncio.to_thread(self._repo.add, ev)
        await self._bus.publish("event", stored)


class EventService:
    def __init__(self, repo: EventRepository) -> None:
        self._repo = repo

    async def list(
        self,
        device_id: int | None = None,
        severity: str | None = None,
        limit: int = 100,
        before_id: int | None = None,
    ) -> list[dict]:
        return await asyncio.to_thread(self._repo.list, device_id, severity, limit, before_id)

    async def ack(self, id: int) -> None:
        await asyncio.to_thread(self._repo.ack, id)

    async def clear(self) -> int:
        return await asyncio.to_thread(self._repo.clear)
