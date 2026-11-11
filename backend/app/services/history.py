from datetime import datetime

from app.infra.repositories import StatusHistoryRepository
from app.services.events import RunDb


class HistoryWriter:
    """Appends every "status" bus message to the status history."""

    def __init__(self, repo: StatusHistoryRepository, run: RunDb) -> None:
        self._repo = repo
        self._run = run

    async def handle(self, payload: dict) -> None:
        ts = datetime.fromisoformat(payload["since"])
        await self._run(self._repo.add, payload["device_id"], payload["status"], ts)

    async def stopped(self, device_ids: list[int], ts: datetime) -> None:
        await self._run(self._repo.add_many, device_ids, "STOPPED", ts)
