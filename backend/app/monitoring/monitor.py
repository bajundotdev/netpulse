import asyncio
import logging
import random
from collections.abc import Awaitable, Callable
from dataclasses import asdict
from datetime import UTC, datetime

from app.domain.models import (
    CheckConfig,
    CheckResult,
    CheckType,
    DeviceConfig,
    DomainEvent,
    EventKind,
    Severity,
)
from app.domain.state import DeviceState, next_state, paused_state
from app.infra.bus import EventBus
from app.monitoring.factory import CheckerFactory
from app.monitoring.resolve import ResolveError, resolve_host
from app.monitoring.status_store import StatusStore

log = logging.getLogger(__name__)


def _liveness_label(check: CheckConfig) -> str:
    if check.type is CheckType.TCP:
        return f"tcp/{check.params.get('port')}"
    return check.type.value


class Monitor:
    def __init__(
        self,
        factory: CheckerFactory,
        store: StatusStore,
        bus: EventBus,
        resolver: Callable[[str], Awaitable[str]] = resolve_host,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        restart_delay_s: float = 5.0,
        stagger_s: float = 1.0,
    ) -> None:
        self._factory = factory
        self._store = store
        self._bus = bus
        self._resolver = resolver
        self._clock = clock
        self._restart_delay_s = restart_delay_s
        self._stagger_s = stagger_s
        self._tasks: dict[int, asyncio.Task] = {}
        self._generation: dict[int, int] = {}

    async def start(self, devices: list[DeviceConfig]) -> None:
        for device in devices:
            await self.upsert(device)

    async def stop(self) -> None:
        tasks = list(self._tasks.values())
        self._tasks.clear()
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    async def upsert(self, device: DeviceConfig) -> None:
        await self._cancel(device.id)
        generation = self._generation.get(device.id, 0) + 1
        self._generation[device.id] = generation
        if device.enabled:
            self._tasks[device.id] = asyncio.create_task(self._loop(device))
            return
        prev = self._store.state(device.id) or DeviceState.initial(self._clock())
        state, event = paused_state(prev, device.name, device.id, self._clock())
        self._store.set_state(device.id, state)
        if event is not None:
            await self._publish_change(device.id, prev, state, event)

    async def remove(self, device_id: int) -> None:
        await self._cancel(device_id)
        self._generation.pop(device_id, None)
        self._store.remove(device_id)

    async def _cancel(self, device_id: int) -> None:
        task = self._tasks.pop(device_id, None)
        if task is not None:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def _loop(self, device: DeviceConfig) -> None:
        await asyncio.sleep(random.uniform(0, self._stagger_s))
        loop = asyncio.get_running_loop()
        while True:
            started = loop.time()
            try:
                await self.run_cycle(device)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log.exception("check cycle failed for %s", device.name)
                await self._bus.publish(
                    "domain_event",
                    DomainEvent(
                        device_id=device.id,
                        severity=Severity.WARNING,
                        kind=EventKind.CHECK_ERROR,
                        message=f"{device.name} check error: {e}",
                        ts=self._clock(),
                    ),
                )
                await asyncio.sleep(self._restart_delay_s)
                continue
            await asyncio.sleep(max(0.0, device.interval_s - (loop.time() - started)))

    async def _run_one(self, check: CheckConfig, device: DeviceConfig, host: str) -> CheckResult:
        try:
            checker = self._factory.build(check, device)
            result = await checker.check(host, device.timeout_ms)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            result = CheckResult(check.type, _liveness_label(check), False, reason=f"error: {e}")
        if result.check_id is None:
            result.check_id = check.id
        return result

    async def _run_checks(self, device: DeviceConfig) -> list[CheckResult]:
        liveness_cfg = device.liveness_check()
        try:
            host = await self._resolver(device.host)
        except ResolveError:
            return [
                CheckResult(
                    liveness_cfg.type, _liveness_label(liveness_cfg), False, reason="dns"
                )
            ]
        liveness = await self._run_one(liveness_cfg, device, host)
        if not liveness.ok:
            return [liveness]
        others = [c for c in device.checks if c.enabled]
        rest = await asyncio.gather(*(self._run_one(c, device, host) for c in others))
        return [liveness, *rest]

    async def test(self, device: DeviceConfig) -> list[CheckResult]:
        return await self._run_checks(device)

    async def run_cycle(self, device: DeviceConfig) -> list[CheckResult]:
        generation = self._generation.get(device.id)
        results = await self._run_checks(device)
        if self._generation.get(device.id) != generation:
            return results
        liveness, others = results[0], results[1:]
        prev = self._store.state(device.id) or DeviceState.initial(self._clock())
        state, event = next_state(
            prev, device.name, device.id, liveness, others, device.fail_threshold, self._clock()
        )
        self._store.set_state(device.id, state)
        self._store.set_results(device.id, results)
        self._store.add_latency(device.id, liveness.latency_ms if liveness.ok else None)
        if event is not None:
            await self._publish_change(device.id, prev, state, event)
        await self._bus.publish(
            "result",
            {
                "device_id": device.id,
                "results": [asdict(r) for r in results],
                "latency_ms": liveness.latency_ms,
            },
        )
        return results

    async def _publish_change(
        self, device_id: int, prev: DeviceState, state: DeviceState, event: DomainEvent
    ) -> None:
        await self._bus.publish(
            "status",
            {
                "device_id": device_id,
                "status": state.status.value,
                "previous_status": prev.status.value,
                "since": state.since.isoformat(),
                "consecutive_failures": state.consecutive_failures,
            },
        )
        await self._bus.publish("domain_event", event)
