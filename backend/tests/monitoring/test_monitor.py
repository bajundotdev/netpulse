import asyncio
from datetime import UTC, datetime, timedelta

import pytest

from app.domain.models import (
    CheckConfig,
    CheckResult,
    CheckType,
    DeviceConfig,
    DeviceStatus,
    EventKind,
    Severity,
)
from app.infra.bus import EventBus
from app.monitoring.factory import CheckerFactory, default_factory
from app.monitoring.monitor import Monitor
from app.monitoring.resolve import ResolveError
from app.monitoring.status_store import StatusStore


class FakeChecker:
    def __init__(self, results, delay=0.0):
        self.results = list(results)
        self.delay = delay
        self.calls = 0

    async def check(self, host, timeout_ms):
        self.calls += 1
        if self.delay:
            await asyncio.sleep(self.delay)
        r = self.results[0] if len(self.results) == 1 else self.results.pop(0)
        if isinstance(r, Exception):
            raise r
        return CheckResult(r.type, r.label, r.ok, r.check_id, r.latency_ms, r.reason, r.value)


def ok(latency=5.0):
    return CheckResult(CheckType.PING, "ping", True, latency_ms=latency)


def fail(reason="timeout"):
    return CheckResult(CheckType.PING, "ping", False, reason=reason)


async def fake_resolver(host):
    return host


class RecordingBus(EventBus):
    def __init__(self):
        super().__init__()
        self.published = []

    async def publish(self, topic, payload):
        self.published.append((topic, payload))
        await super().publish(topic, payload)

    def of(self, topic):
        return [p for t, p in self.published if t == topic]


def make_clock():
    t = {"now": datetime(2026, 1, 1, tzinfo=UTC)}

    def clock():
        t["now"] += timedelta(seconds=1)
        return t["now"]

    return clock


def device(**kw):
    base = dict(id=1, name="sw1", host="10.0.0.1", interval_s=2, fail_threshold=2)
    base.update(kw)
    return DeviceConfig(**base)


def build(ping, extra=None, resolver=fake_resolver, **mkw):
    factory = CheckerFactory()
    factory.register(CheckType.PING, lambda c, d: ping)
    if extra is not None:
        factory.register(CheckType.TCP, lambda c, d: extra)
    store = StatusStore()
    bus = RecordingBus()
    mon = Monitor(factory, store, bus, resolver=resolver, clock=make_clock(),
                  restart_delay_s=0, stagger_s=0, **mkw)
    return mon, store, bus


async def test_cycle_up_publishes_status_result_and_domain_event():
    mon, store, bus = build(FakeChecker([ok(7.0)]))
    results = await mon.run_cycle(device())
    assert [r.ok for r in results] == [True]
    status = bus.of("status")
    assert len(status) == 1
    assert status[0]["status"] == "UP"
    assert status[0]["previous_status"] == "UNKNOWN"
    assert status[0]["consecutive_failures"] == 0
    assert isinstance(status[0]["since"], str)
    res = bus.of("result")
    assert res[0]["latency_ms"] == 7.0
    assert res[0]["results"][0]["type"] == "ping"
    events = bus.of("domain_event")
    assert len(events) == 1 and events[0].status == "UP"
    assert store.state(1).status is DeviceStatus.UP
    assert store.latency(1) == [7.0]


async def test_two_failed_cycles_go_down_once():
    mon, store, bus = build(FakeChecker([fail()]))
    d = device()
    for _ in range(3):
        await mon.run_cycle(d)
    downs = [e for e in bus.of("domain_event") if e.status == "DOWN"]
    assert len(downs) == 1
    assert store.latency(1) == [None, None, None]


async def test_others_skipped_when_liveness_fails():
    tcp = FakeChecker([CheckResult(CheckType.TCP, "tcp/80", True)])
    mon, _, bus = build(FakeChecker([fail()]), extra=tcp)
    d = device(checks=(CheckConfig(5, CheckType.TCP, {"port": 80}),))
    results = await mon.run_cycle(d)
    assert tcp.calls == 0
    assert len(results) == 1


async def test_others_run_and_degrade_when_liveness_ok():
    tcp = FakeChecker([CheckResult(CheckType.TCP, "tcp/80", False, reason="refused")])
    mon, store, bus = build(FakeChecker([ok()]), extra=tcp)
    off = CheckConfig(6, CheckType.TCP, {"port": 81}, enabled=False)
    d = device(checks=(CheckConfig(5, CheckType.TCP, {"port": 80}), off))
    results = await mon.run_cycle(d)
    assert tcp.calls == 1
    assert [r.check_id for r in results] == [None, 5]
    assert store.state(1).status is DeviceStatus.DEGRADED


async def test_dns_failure_is_liveness_failure_with_reason_dns():
    async def bad(host):
        raise ResolveError("nope")

    mon, _, bus = build(FakeChecker([ok()]), resolver=bad)
    results = await mon.run_cycle(device())
    assert results[0].label == "ping"
    assert results[0].reason == "dns"
    assert results[0].ok is False


async def test_dns_failure_label_for_tcp_liveness():
    async def bad(host):
        raise ResolveError("nope")

    mon, _, _ = build(FakeChecker([ok()]), resolver=bad)
    results = await mon.run_cycle(device(liveness="tcp", liveness_port=443))
    assert results[0].label == "tcp/443"
    assert results[0].type is CheckType.TCP


async def test_checker_exception_becomes_failed_result_not_crash():
    mon, _, _ = build(FakeChecker([RuntimeError("boom")]))
    results = await mon.run_cycle(device())
    assert results[0].ok is False
    assert results[0].reason == "error: boom"


async def test_disable_device_sets_paused_and_stops_task():
    mon, store, bus = build(FakeChecker([ok()]))
    d = device(interval_s=2)
    await mon.upsert(d)
    await asyncio.sleep(0.05)
    assert 1 in mon._tasks
    await mon.upsert(device(enabled=False))
    assert 1 not in mon._tasks
    assert store.state(1).status is DeviceStatus.PAUSED
    assert bus.of("status")[-1]["status"] == "PAUSED"
    await mon.stop()


async def test_upsert_during_slow_cycle_discards_stale_result():
    mon, _, bus = build(FakeChecker([ok()], delay=0.2))
    await mon.start([device()])
    await asyncio.sleep(0.05)
    await mon.upsert(device(interval_s=3))
    assert bus.of("result") == []
    await mon.stop()
    assert bus.of("result") == []


async def test_stale_generation_result_is_not_published():
    ping = FakeChecker([ok()], delay=0.1)
    mon, _, bus = build(ping)
    d = device()
    mon._generation[1] = 1
    task = asyncio.create_task(mon.run_cycle(d))
    await asyncio.sleep(0.02)
    mon._generation[1] = 2
    await task
    assert bus.published == []


async def test_test_method_has_no_side_effects():
    mon, store, bus = build(FakeChecker([ok()]))
    results = await mon.test(device())
    assert results[0].ok
    assert bus.published == []
    assert store.state(1) is None and store.latency(1) == []


async def test_remove_drops_store_entry_and_generation():
    mon, store, _ = build(FakeChecker([ok()]))
    await mon.start([device()])
    await asyncio.sleep(0.05)
    await mon.remove(1)
    assert store.state(1) is None
    assert 1 not in mon._generation and 1 not in mon._tasks
    await mon.stop()


async def test_loop_restarts_after_unexpected_error_and_logs_check_error():
    mon, _, bus = build(FakeChecker([ok()]))
    real = mon.run_cycle
    calls = {"n": 0}

    async def flaky(d):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("kaput")
        return await real(d)

    mon.run_cycle = flaky
    await mon.upsert(device(interval_s=2))
    await asyncio.sleep(0.1)
    await mon.stop()
    errs = [e for e in bus.of("domain_event") if e.kind is EventKind.CHECK_ERROR]
    assert len(errs) == 1
    assert errs[0].severity is Severity.WARNING
    assert errs[0].message == "sw1 check error: kaput"
    assert calls["n"] >= 2


def test_factory_unknown_type_raises():
    f = CheckerFactory()
    with pytest.raises(ValueError):
        f.build(CheckConfig(None, CheckType.TCP, {}), device())


def test_default_factory_builds_ping():
    c = default_factory().build(CheckConfig(None, CheckType.PING, {}), device())
    assert hasattr(c, "check")


async def test_event_bus_handler_error_is_isolated():
    bus = EventBus()
    seen = []

    async def bad(p):
        raise RuntimeError("x")

    async def good(p):
        seen.append(p)

    bus.subscribe("t", bad)
    bus.subscribe("t", good)
    await bus.publish("t", 1)
    assert seen == [1]
