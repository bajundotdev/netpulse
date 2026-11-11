"""CPU budget check: 50 devices at 5 s intervals must stay under 5 % of one core.

Runs the real app (scheduler, state machine, store, bus, SQLite, event log) with fake
checkers that sleep 20 ms and succeed, so nothing touches the network.

    cd backend && .venv/bin/python scripts/perf_check.py [seconds]
"""

import asyncio
import sys
import tempfile
import time
from pathlib import Path

import httpx2 as httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings  # noqa: E402
from app.domain.models import CheckResult, CheckType  # noqa: E402
from app.main import create_app  # noqa: E402
from app.monitoring.factory import CheckerFactory  # noqa: E402

DEVICES = 50
INTERVAL_S = 5
BUDGET_PCT = 5.0
CHECK_DELAY_S = 0.02


class FakeChecker:
    def __init__(self, type: CheckType, label: str) -> None:
        self.type, self.label = type, label

    async def check(self, host: str, timeout_ms: int) -> CheckResult:
        await asyncio.sleep(CHECK_DELAY_S)
        return CheckResult(self.type, self.label, True, latency_ms=CHECK_DELAY_S * 1000)


def fake_factory() -> CheckerFactory:
    factory = CheckerFactory()
    factory.register(CheckType.PING, lambda c, d: FakeChecker(CheckType.PING, "ping"))
    factory.register(
        CheckType.TCP, lambda c, d: FakeChecker(CheckType.TCP, f"tcp/{c.params['port']}")
    )
    return factory


async def run(duration_s: float) -> float:
    with tempfile.TemporaryDirectory() as tmp:
        app = create_app(Settings(data_dir=Path(tmp)), factory=fake_factory())
        async with app.router.lifespan_context(app):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://perf") as api:
                for i in range(DEVICES):
                    r = await api.post(
                        "/api/devices",
                        json={
                            "name": f"dev-{i:02d}",
                            "host": f"10.0.{i // 250}.{i % 250 + 1}",
                            "interval_s": INTERVAL_S,
                            "checks": [
                                {"type": "tcp", "params": {"port": 389}},
                                {"type": "tcp", "params": {"port": 445}},
                            ],
                        },
                    )
                    r.raise_for_status()
                cpu0, wall0 = time.process_time(), time.monotonic()
                await asyncio.sleep(duration_s)
                cpu, wall = time.process_time() - cpu0, time.monotonic() - wall0
    return 100.0 * cpu / wall


def main() -> int:
    duration = float(sys.argv[1]) if len(sys.argv) > 1 else 60.0
    pct = asyncio.run(run(duration))
    verdict = "CPU < 5%" if pct < BUDGET_PCT else "CPU >= 5%"
    print(f"{DEVICES} devices @ {INTERVAL_S}s for {duration:.0f}s: {pct:.2f}% of one core, {verdict}")
    return 0 if pct < BUDGET_PCT else 1


if __name__ == "__main__":
    raise SystemExit(main())
