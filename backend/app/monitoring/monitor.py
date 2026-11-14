import asyncio
import logging
import random
from collections.abc import Awaitable, Callable
from dataclasses import asdict, replace
from datetime import UTC, datetime

from app.domain.detectors import ChangeTracker
from app.domain.models import (
    CheckConfig,
    CheckResult,
    CheckType,
    DeviceConfig,
    DeviceStatus,
    DomainEvent,
    EventKind,
    Severity,
)
from app.domain.state import DeviceState, next_state, paused_state
from app.infra.bus import EventBus
from app.monitoring.checkers.http import check_error_reason
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
        tracker: ChangeTracker | None = None,
    ) -> None:
        self._factory = factory
        self._store = store
        self._bus = bus
        self._resolver = resolver
        self._clock = clock
        self._restart_delay_s = restart_delay_s
        self._stagger_s = stagger_s
        self._tracker = tracker or ChangeTracker()
        self._tasks: dict[int, asyncio.Task] = {}
        self._generation: dict[int, int] = {}
        # Each device's last real status from before a restart; consulted once, at its first change.
        self._last_known: dict[int, str] = {}

    def set_last_known(self, statuses: dict[int, str]) -> None:
        self._last_known = dict(statuses)

    async def start(
        self, devices: list[DeviceConfig], last_known: dict[int, str] | None = None
    ) -> None:
        if last_known is not None:
            self.set_last_known(last_known)
        for device in devices:
            await self.upsert(device)

    async def stop(self) -> None:
        tasks = list(self._tasks.values())
        self._tasks.clear()
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    async def upsert(self, device: DeviceConfig) -> None:
        # Swap synchronously (no await between pop and store) so concurrent calls cannot orphan a task.
        old = self._tasks.pop(device.id, None)
        if old is not None:
            old.cancel()
        self._tracker.forget(device.id)  # any config change re-baselines SNMP detectors
        generation = self._generation.get(device.id, 0) + 1
        self._generation[device.id] = generation
        prev = self._store.state(device.id)
        reset: DeviceState | None = None
        if device.enabled:
            if prev is None or prev.status is DeviceStatus.PAUSED:
                reset = DeviceState.initial(self._clock())
                self._store.set_state(device.id, reset)
            self._tasks[device.id] = asyncio.create_task(self._loop(device, generation))
        await self._reap(old)
        if self._generation.get(device.id) != generation:
            return
        if device.enabled:
            if reset is not None:
                await self._publish_status(
                    device.id, reset, prev.status.value if prev is not None else None
                )
            return
        prev = prev or DeviceState.initial(self._clock())
        state, event = paused_state(prev, device.name, device.id, self._clock())
        self._store.set_state(device.id, state)
        if event is not None:
            await self._publish_change(device.id, prev, state, event)

    async def remove(self, device_id: int) -> None:
        self._last_known.pop(device_id, None)
        old = self._tasks.pop(device_id, None)
        if old is not None:
            old.cancel()
        self._generation.pop(device_id, None)
        self._tracker.forget(device_id)
        self._store.remove(device_id)
        await self._reap(old)

    @staticmethod
    async def _reap(task: asyncio.Task | None) -> None:
        if task is not None:
            await asyncio.gather(task, return_exceptions=True)

    async def _loop(self, device: DeviceConfig, generation: int) -> None:
        await asyncio.sleep(random.uniform(0, self._stagger_s))
        loop = asyncio.get_running_loop()
        while True:
            started = loop.time()
            try:
                await self.run_cycle(device, generation)
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
            result = await asyncio.wait_for(
                checker.check(host, device.timeout_ms), device.timeout_ms / 1000 + 1
            )
        except asyncio.CancelledError:
            raise
        except TimeoutError:
            result = CheckResult(check.type, _liveness_label(check), False, reason="timeout")
        except Exception as e:
            # A check with a secret never lets exception text through unfiltered (it can embed
            # the request headers): same opaque/scrub policy as the HTTP checker.
            reason = (
                check_error_reason(e, check.params, check.secret)
                if check.secret
                else f"error: {e}"
            )
            result = CheckResult(check.type, _liveness_label(check), False, reason=reason)
        if result.check_id is None:
            result.check_id = check.id
        return result

    async def _run_checks(self, device: DeviceConfig) -> list[CheckResult]:
        liveness_cfg = device.liveness_check()
        try:
            # Bounded: a hung DNS server must not stall the cycle (getaddrinfo cannot be cancelled,
            # but the cycle stops waiting for it).
            host = await asyncio.wait_for(
                self._resolver(device.host), device.timeout_ms / 1000 + 1
            )
        except (ResolveError, TimeoutError):
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

    async def run_cycle(
        self, device: DeviceConfig, generation: int | None = None
    ) -> list[CheckResult]:
        if generation is None:
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
        latency = liveness.latency_ms if liveness.ok else None
        self._store.add_latency(device.id, latency)
        if event is not None:
            await self._publish_change(device.id, prev, state, event)
        checks = [c for c in device.checks if c.enabled]
        for check, result in zip(checks, others):
            for ev in self._tracker.observe(device.id, device.name, check, result):
                await self._bus.publish("domain_event", ev)
        await self._bus.publish(
            "result",
            {
                "device_id": device.id,
                "results": [asdict(r) for r in results],
                "latency_ms": latency,
                # current state too, so a client that missed a status message catches up
                "status": state.status.value,
                "since": state.since.isoformat(),
                "consecutive_failures": state.consecutive_failures,
            },
        )
        return results

    async def _publish_status(
        self, device_id: int, state: DeviceState, previous_status: str | None
    ) -> None:
        await self._bus.publish(
            "status",
            {
                "device_id": device_id,
                "status": state.status.value,
                "previous_status": previous_status,
                "since": state.since.isoformat(),
                "consecutive_failures": state.consecutive_failures,
            },
        )

    async def _publish_change(
        self, device_id: int, prev: DeviceState, state: DeviceState, event: DomainEvent
    ) -> None:
        await self._publish_status(device_id, state, prev.status.value)
        if prev.status is DeviceStatus.UNKNOWN and device_id in self._last_known:
            # First change after a restart: compare with the status from before the restart,
            # so restarting NetPulse does not log every device again.
            last = self._last_known.pop(device_id)
            if last == state.status.value:
                return
            event = replace(event, previous_status=last)
        await self._bus.publish("domain_event", event)
