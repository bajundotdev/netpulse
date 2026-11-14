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

    async def flaky(d, generation=None):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("kaput")
        return await real(d, generation)

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


class SlowCancelChecker:
    async def check(self, host, timeout_ms):
        try:
            await asyncio.sleep(10)
        except asyncio.CancelledError:
            await asyncio.sleep(0.05)
            raise


async def test_concurrent_upserts_leave_one_live_loop():
    mon, _, _ = build(SlowCancelChecker())
    d = device()
    await mon.upsert(d)
    await asyncio.sleep(0.02)
    await asyncio.gather(mon.upsert(d), mon.upsert(d))
    await asyncio.sleep(0.02)
    live = [t for t in asyncio.all_tasks() if t.get_coro().__qualname__ == "Monitor._loop" and not t.done()]
    assert len(live) == 1 and len(mon._tasks) == 1
    await mon.stop()
    live = [t for t in asyncio.all_tasks() if t.get_coro().__qualname__ == "Monitor._loop" and not t.done()]
    assert live == []


async def test_hung_checker_times_out_with_reason_timeout():
    mon, _, _ = build(FakeChecker([ok()], delay=30))
    loop = asyncio.get_running_loop()
    start = loop.time()
    results = await mon.run_cycle(device(timeout_ms=200))
    assert loop.time() - start < 2.0
    assert results[0].ok is False and results[0].reason == "timeout"


async def test_reenabled_device_resets_paused_to_unknown():
    mon, store, _ = build(FakeChecker([fail()]), )
    await mon.upsert(device(enabled=False))
    assert store.state(1).status is DeviceStatus.PAUSED
    await mon.upsert(device(fail_threshold=2))
    assert store.state(1).status is DeviceStatus.UNKNOWN
    await asyncio.sleep(0.05)
    await mon.stop()
    assert store.state(1).status is DeviceStatus.UNKNOWN


async def test_reenable_publishes_unknown_status_without_domain_event():
    mon, store, bus = build(FakeChecker([fail()]))
    await mon.upsert(device(enabled=False))
    before_events = len(bus.of("domain_event"))
    bus.published.clear()
    await mon.upsert(device(fail_threshold=2))
    statuses = bus.of("status")
    assert statuses[0]["status"] == "UNKNOWN"
    assert statuses[0]["previous_status"] == "PAUSED"
    assert statuses[0]["device_id"] == 1
    assert bus.of("domain_event") == [] and before_events == 1
    await mon.stop()


async def test_new_enabled_device_publishes_unknown_status_with_null_previous():
    mon, store, bus = build(FakeChecker([ok()]))
    await mon.upsert(device())
    first = bus.of("status")[0]
    assert first["status"] == "UNKNOWN" and first["previous_status"] is None
    assert bus.of("domain_event") == []
    await mon.stop()


async def test_result_payload_latency_is_none_when_liveness_failed():
    failed_with_latency = CheckResult(CheckType.PING, "ping", False, latency_ms=9.0, reason="timeout")
    mon, store, bus = build(FakeChecker([failed_with_latency]))
    await mon.run_cycle(device())
    assert bus.of("result")[0]["latency_ms"] is None
    assert store.latency(1) == [None]


async def test_snmp_uptime_drop_publishes_one_reboot_event():
    uptime = FakeChecker([
        CheckResult(CheckType.SNMP_UPTIME, "snmp uptime", True, value=500000),
        CheckResult(CheckType.SNMP_UPTIME, "snmp uptime", True, value=1200),
    ])
    mon, _, bus = build(FakeChecker([ok()]))
    mon._factory.register(CheckType.SNMP_UPTIME, lambda c, d: uptime)
    d = device(checks=(CheckConfig(7, CheckType.SNMP_UPTIME, {}),))
    await mon.run_cycle(d)
    await mon.run_cycle(d)
    reboots = [e for e in bus.of("domain_event") if getattr(e, "kind", None) is EventKind.REBOOT]
    assert len(reboots) == 1 and reboots[0].check_id == 7


async def test_stale_cycle_publishes_no_snmp_events():
    uptime = FakeChecker([
        CheckResult(CheckType.SNMP_UPTIME, "snmp uptime", True, value=500000),
        CheckResult(CheckType.SNMP_UPTIME, "snmp uptime", True, value=1200),
    ])
    mon, _, bus = build(FakeChecker([ok()]))
    mon._factory.register(CheckType.SNMP_UPTIME, lambda c, d: uptime)
    d = device(checks=(CheckConfig(7, CheckType.SNMP_UPTIME, {}),))
    await mon.run_cycle(d)
    await mon.run_cycle(d, generation=99)  # stale: generation no longer matches
    assert not [e for e in bus.of("domain_event") if getattr(e, "kind", None) is EventKind.REBOOT]


def test_snmp_check_without_snmp_settings_fails_to_build():
    f = default_factory(object())
    with pytest.raises(ValueError):
        f.build(CheckConfig(1, CheckType.SNMP_UPTIME, {}), device())


def test_pysnmp_client_close_is_safe_twice():
    from app.monitoring.snmp_client import PysnmpClient

    c = PysnmpClient()
    c.close()
    c._get_engine()
    c.close()
    c.close()


def _snmp(check_type, label, value, ok_=True):
    return CheckResult(check_type, label, ok_, value=value)


async def test_upsert_rebaselines_uptime_so_edit_does_not_fake_a_reboot():
    uptime = FakeChecker([_snmp(CheckType.SNMP_UPTIME, "snmp uptime", 500000),
                          _snmp(CheckType.SNMP_UPTIME, "snmp uptime", 1200)])
    mon, _, bus = build(FakeChecker([ok()]))
    mon._factory.register(CheckType.SNMP_UPTIME, lambda c, d: uptime)
    d = device(checks=(CheckConfig(7, CheckType.SNMP_UPTIME, {}),))
    await mon.run_cycle(d)
    edited = device(enabled=False, checks=(CheckConfig(7, CheckType.SNMP_UPTIME, {"x": 1}),))
    await mon.upsert(edited)
    await mon.run_cycle(edited, generation=mon._generation[1])
    assert not [e for e in bus.of("domain_event") if getattr(e, "kind", None) is EventKind.REBOOT]


async def test_upsert_rebaselines_oid_when_same_id_switches_mode():
    oid = FakeChecker([_snmp(CheckType.SNMP_OID, "oid:x", 5), _snmp(CheckType.SNMP_OID, "oid:x", 4)])
    mon, _, bus = build(FakeChecker([ok()]))
    mon._factory.register(CheckType.SNMP_OID, lambda c, d: oid)
    change = {"oid": "1.3.6.1", "label": "x", "mode": "change"}
    thr = {"oid": "1.3.6.1", "label": "x", "mode": "threshold", "op": ">", "value": 90}
    await mon.run_cycle(device(checks=(CheckConfig(8, CheckType.SNMP_OID, change),)))
    edited = device(enabled=False, checks=(CheckConfig(8, CheckType.SNMP_OID, thr),))
    await mon.upsert(edited)
    await mon.run_cycle(edited, generation=mon._generation[1])
    kinds = {getattr(e, "kind", None) for e in bus.of("domain_event")}
    assert EventKind.OID_CHANGE not in kinds and EventKind.OID_THRESHOLD not in kinds


async def test_uptime_drop_without_upsert_still_reboots_once():
    uptime = FakeChecker([_snmp(CheckType.SNMP_UPTIME, "snmp uptime", 500000),
                          _snmp(CheckType.SNMP_UPTIME, "snmp uptime", 1200)])
    mon, _, bus = build(FakeChecker([ok()]))
    mon._factory.register(CheckType.SNMP_UPTIME, lambda c, d: uptime)
    d = device(checks=(CheckConfig(7, CheckType.SNMP_UPTIME, {}),))
    await mon.run_cycle(d)
    await mon.run_cycle(d)
    reboots = [e for e in bus.of("domain_event") if getattr(e, "kind", None) is EventKind.REBOOT]
    assert len(reboots) == 1


async def test_result_payload_carries_current_status():
    mon, _, bus = build(FakeChecker([fail()]))
    d = device()
    await mon.run_cycle(d)
    first = bus.of("result")[-1]
    assert first["status"] == "UNKNOWN" and first["consecutive_failures"] == 1
    assert isinstance(first["since"], str)
    await mon.run_cycle(d)
    second = bus.of("result")[-1]
    assert second["status"] == "DOWN" and second["consecutive_failures"] == 2
    assert second["since"] == bus.of("status")[-1]["since"]


async def test_slow_dns_is_liveness_failure_with_reason_dns():
    async def slow(host):
        await asyncio.sleep(30)

    mon, _, _ = build(FakeChecker([ok()]), resolver=slow)
    loop = asyncio.get_running_loop()
    started = loop.time()
    results = await mon.run_cycle(device(timeout_ms=200))
    assert loop.time() - started < 2.0  # timeout_ms/1000 + 1 s
    assert results[0].ok is False and results[0].reason == "dns"


async def test_restart_with_same_status_logs_no_event():
    mon, store, bus = build(FakeChecker([ok()]))
    mon.set_last_known({1: "UP"})
    await mon.run_cycle(device())
    assert [s["status"] for s in bus.of("status")] == ["UP"]  # history and UI still updated
    assert bus.of("domain_event") == []


async def test_restart_with_changed_status_logs_change_from_last_known():
    mon, store, bus = build(FakeChecker([ok()]))
    mon.set_last_known({1: "DOWN"})
    await mon.run_cycle(device())
    [ev] = bus.of("domain_event")
    assert (ev.status, ev.previous_status) == ("UP", "DOWN")  # recovery while NetPulse was off


async def test_last_known_status_is_used_only_for_the_first_change():
    mon, store, bus = build(FakeChecker([ok(), fail(), fail()]))
    mon.set_last_known({1: "UP"})
    for _ in range(3):
        await mon.run_cycle(device())
    [ev] = bus.of("domain_event")
    assert (ev.status, ev.previous_status) == ("DOWN", "UP")


async def test_restart_paused_device_with_same_status_logs_no_event():
    mon, store, bus = build(FakeChecker([ok()]))
    mon.set_last_known({1: "PAUSED"})
    await mon.upsert(device(enabled=False))
    assert store.state(1).status is DeviceStatus.PAUSED
    assert bus.of("domain_event") == []


async def test_start_passes_last_known_statuses():
    mon, store, bus = build(FakeChecker([ok()] * 50))
    await mon.start([device()], last_known={1: "UP"})
    try:
        for _ in range(100):
            if bus.of("result"):
                break
            await asyncio.sleep(0.01)
        assert bus.of("domain_event") == []
    finally:
        await mon.stop()


async def test_error_wrapper_scrubs_secret_of_the_check():
    import base64

    token = base64.b64encode(b"svc:hunter2").decode()
    factory = CheckerFactory()
    factory.register(
        CheckType.HTTP,
        lambda c, d: FakeChecker([RuntimeError(f"bad hunter2 and {token}")]),
    )
    factory.register(CheckType.PING, lambda c, d: FakeChecker([ok()]))
    mon = Monitor(factory, StatusStore(), RecordingBus(), resolver=fake_resolver)
    check = CheckConfig(
        1, CheckType.HTTP, {"url": "https://a/", "auth": {"type": "basic", "username": "svc"}},
        secret="hunter2",
    )
    dev = DeviceConfig(id=1, name="W", host="h", checks=(check,))
    results = await mon.test(dev)
    reason = results[1].reason
    assert "hunter2" not in reason and token not in reason and reason.startswith("error:")


async def test_error_wrapper_hides_text_of_opaque_errors_with_secret():
    factory = CheckerFactory()
    factory.register(CheckType.HTTP, lambda c, d: FakeChecker([ValueError("Bearer hunter2")]))
    factory.register(CheckType.PING, lambda c, d: FakeChecker([ok()]))
    mon = Monitor(factory, StatusStore(), RecordingBus(), resolver=fake_resolver)
    check = CheckConfig(1, CheckType.HTTP, {"url": "https://a/"}, secret="hunter2")
    [_, r] = await mon.test(DeviceConfig(id=1, name="W", host="h", checks=(check,)))
    assert r.reason == "error: ValueError"


def test_check_config_repr_hides_secret():
    check = CheckConfig(1, CheckType.HTTP, {"url": "https://a/"}, secret="hunter2")
    assert "hunter2" not in repr(check) and "hunter2" not in repr(
        DeviceConfig(id=1, name="W", host="h", checks=(check,))
    )


# --- certificate events at monitor level --------------------------------------

class CertChecker:
    """HTTP checker stand-in whose certificate days come from a shared box."""

    def __init__(self, box, ok_=True):
        self.box, self.ok_ = box, ok_

    async def check(self, host, timeout_ms):
        days = self.box["days"]
        value = {"status_code": 200, "elapsed_ms": 1, "cert_expires": "x", "cert_days": days,
                 "final_url": "https://sts.example.ph/"}
        if not self.box.get("up", True):  # outage: the site answers 503, certificate still read
            return CheckResult(CheckType.HTTP, "GET /", False, latency_ms=1.0,
                               reason="status 503", value=value)
        ok_ = days >= 0
        return CheckResult(CheckType.HTTP, "GET /", ok_, latency_ms=1.0,
                           reason=None if ok_ else "tls: certificate has expired", value=value)


def cert_monitor(box):
    factory = CheckerFactory()
    factory.register(CheckType.HTTP, lambda c, d: CertChecker(box))
    bus = RecordingBus()
    return Monitor(factory, StatusStore(), bus, resolver=fake_resolver), bus


def cert_events(bus):
    return [(e.severity, e.message) for e in bus.of("domain_event") if e.kind is EventKind.CERT_EXPIRY]


WEB = dict(id=1, name="STS", host="sts.example.ph", kind="web", liveness="http",
           url="https://sts.example.ph/", fail_threshold=1)


async def test_expired_cert_on_liveness_only_device_fires_one_critical():
    box = {"days": -3}
    mon, bus = cert_monitor(box)
    dev = DeviceConfig(**WEB)
    for _ in range(3):
        await mon.run_cycle(dev)
    assert cert_events(bus) == [(Severity.CRITICAL, "STS cert for sts.example.ph expired")]


async def test_liveness_and_explicit_check_share_one_warning():
    box = {"days": 40}
    mon, bus = cert_monitor(box)
    check = CheckConfig(5, CheckType.HTTP, {"url": "https://sts.example.ph/x", "cert_warn_days": 30})
    dev = DeviceConfig(**WEB, checks=(check,))
    await mon.run_cycle(dev)
    box["days"] = 12
    for _ in range(4):
        await mon.run_cycle(dev)
    assert cert_events(bus) == [(Severity.WARNING, "STS cert for sts.example.ph expires in 12 days")]
    [ev] = [e for e in bus.of("domain_event") if e.kind is EventKind.CERT_EXPIRY]
    assert ev.check_id == 5


async def test_smallest_warn_threshold_of_explicit_checks_wins():
    box = {"days": 20}
    mon, bus = cert_monitor(box)
    checks = (
        CheckConfig(5, CheckType.HTTP, {"url": "https://sts.example.ph/a", "cert_warn_days": 30}),
        CheckConfig(6, CheckType.HTTP, {"url": "https://sts.example.ph/b", "cert_warn_days": 10}),
    )
    dev = DeviceConfig(**WEB, checks=checks)
    await mon.run_cycle(dev)
    assert cert_events(bus) == []
    box["days"] = 9
    await mon.run_cycle(dev)
    assert len(cert_events(bus)) == 1


async def test_renewal_fires_info_once():
    box = {"days": -2}
    mon, bus = cert_monitor(box)
    dev = DeviceConfig(**WEB)
    await mon.run_cycle(dev)
    box["days"] = 89
    for _ in range(3):
        await mon.run_cycle(dev)
    assert cert_events(bus) == [
        (Severity.CRITICAL, "STS cert for sts.example.ph expired"),
        (Severity.INFO, "STS cert for sts.example.ph renewed (89 days)"),
    ]


@pytest.mark.parametrize(
    ("warn_days", "cert_days", "before"),
    [
        (30, 20, [(Severity.WARNING, "STS cert for sts.example.ph expires in 20 days")]),
        (7, 10, []),
    ],
)
async def test_outage_keeps_the_explicit_check_threshold(warn_days, cert_days, before):
    """While liveness fails only its result is seen; the threshold still comes from the configs."""
    box = {"days": cert_days}
    mon, bus = cert_monitor(box)
    check = CheckConfig(
        5, CheckType.HTTP, {"url": "https://sts.example.ph/x", "cert_warn_days": warn_days}
    )
    dev = DeviceConfig(**WEB, checks=(check,))
    await mon.run_cycle(dev)
    assert cert_events(bus) == before
    box["up"] = False
    for _ in range(3):
        [liveness] = await mon.run_cycle(dev)
        assert not liveness.ok
    box["up"] = True
    for _ in range(2):
        await mon.run_cycle(dev)
    assert cert_events(bus) == before


async def test_disabled_check_threshold_does_not_count():
    box = {"days": 20}
    mon, bus = cert_monitor(box)
    check = CheckConfig(
        5, CheckType.HTTP, {"url": "https://sts.example.ph/x", "cert_warn_days": 30}, enabled=False
    )
    await mon.run_cycle(DeviceConfig(**WEB, checks=(check,)))
    assert cert_events(bus) == []


# --- HTTP liveness does its own name resolution (or goes through a proxy) -----

async def unresolvable(host):
    raise ResolveError(host)


async def test_http_liveness_skips_the_local_pre_resolve():
    """Where external names resolve only through the proxy, the HTTP request still runs."""
    import httpx2

    from app.monitoring.checkers.http import HttpClientPool

    seen = []

    def handler(request):
        seen.append(str(request.url))
        return httpx2.Response(200)

    class NoCert:
        async def expiry(self, host, port, timeout_ms):
            return None

    pool = HttpClientPool(transport=httpx2.MockTransport(handler))
    factory = default_factory(http_pool=pool, cert_reader=NoCert())
    mon = Monitor(factory, StatusStore(), RecordingBus(), resolver=unresolvable)
    dev = DeviceConfig(id=1, name="Ext", host="only-via-proxy.example", kind="web",
                       liveness="http", url="https://only-via-proxy.example/")
    try:
        [liveness] = await mon.test(dev)
    finally:
        await pool.aclose()
    assert liveness.ok and liveness.reason is None
    assert seen == ["https://only-via-proxy.example/"]


async def test_http_liveness_non_http_checks_still_resolve_first():
    factory = CheckerFactory()
    up = CheckResult(CheckType.HTTP, "GET /", True, latency_ms=5.0)
    factory.register(CheckType.HTTP, lambda c, d: FakeChecker([up]))
    tcp = FakeChecker([CheckResult(CheckType.TCP, "tcp/443", True, latency_ms=1.0)])
    factory.register(CheckType.TCP, lambda c, d: tcp)
    mon = Monitor(factory, StatusStore(), RecordingBus(), resolver=unresolvable)
    checks = (CheckConfig(3, CheckType.TCP, {"port": 443}),)
    dev = DeviceConfig(id=1, name="Ext", host="only-via-proxy.example", kind="web",
                       liveness="http", url="https://only-via-proxy.example/", checks=checks)
    liveness, r = await mon.test(dev)
    assert liveness.ok
    assert not r.ok and r.reason == "dns" and r.label == "tcp/443" and r.check_id == 3
    assert tcp.calls == 0
