from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from app.domain.history import bucketize, overall, uptime_pct, window
from app.infra.repositories import DeviceRepository, StatusHistoryRepository
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


class HistoryService:
    """Builds the `GET /api/history` payload: slots, uptime and problem counts per device."""

    def __init__(
        self,
        history_repo: StatusHistoryRepository,
        device_repo: DeviceRepository,
        run: RunDb,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._history = history_repo
        self._devices = device_repo
        self._run = run
        self._clock = clock

    async def get(self, range_key: str) -> dict:
        # One synchronous step through the runner: a single consistent read of the
        # database and all the slot maths off the event loop.
        return await self._run(self._build, range_key, self._clock())

    def _build(self, range_key: str, now: datetime) -> dict:
        start, end, bucket_s = window(range_key, now)
        rows = self._history.window_rows(start, end)
        ids = sorted(d.id for d in self._devices.list())
        problems_last_hour = self._history.problem_entries_since(now - timedelta(seconds=3600))
        slots = {i: bucketize(rows.get(i, []), start, end, bucket_s, now) for i in ids}
        if ids:
            problems, status = overall([slots[i] for i in ids])
        else:
            count = len(bucketize([], start, end, bucket_s, now))
            problems, status = [0] * count, [None] * count
        return {
            "range": range_key,
            "start": start,
            "end": end,
            "bucket_seconds": bucket_s,
            "problems_last_hour": problems_last_hour,
            "overall": {"problems": problems, "status": status},
            "devices": [
                {
                    "device_id": i,
                    "buckets": slots[i],
                    "uptime_pct": uptime_pct(rows.get(i, []), start, end, now),
                }
                for i in ids
            ],
        }
