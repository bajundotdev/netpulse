import asyncio
import socket

from app.domain.models import CheckConfig, CheckResult, CheckType, DeviceStatus
from app.monitoring.checkers.tcp import TcpChecker
from app.monitoring.factory import default_factory
from tests.monitoring.test_monitor import FakeChecker, build, device, fail, ok


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


async def test_tcp_open_port_ok():
    server = await asyncio.start_server(lambda r, w: w.close(), "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    try:
        r = await TcpChecker(port).check("127.0.0.1", 500)
    finally:
        server.close()
        await server.wait_closed()
    assert r.ok and r.type is CheckType.TCP and r.label == f"tcp/{port}"
    assert r.latency_ms is not None and r.reason is None


async def test_tcp_closed_port_refused():
    port = free_port()
    r = await TcpChecker(port).check("127.0.0.1", 500)
    assert not r.ok and r.reason == "refused" and r.label == f"tcp/{port}"


async def test_tcp_timeout():
    async def slow(host, port):
        await asyncio.sleep(5)

    r = await TcpChecker(80, connect=slow).check("10.255.255.1", 100)
    assert not r.ok and r.reason == "timeout" and r.label == "tcp/80"


async def test_tcp_other_oserror_reported():
    async def broken(host, port):
        raise OSError("network unreachable")

    r = await TcpChecker(80, connect=broken).check("10.0.0.1", 100)
    assert not r.ok and r.reason == "error: network unreachable"


async def test_tcp_close_errors_are_swallowed():
    class W:
        def close(self):
            pass

        async def wait_closed(self):
            raise ConnectionResetError("reset")

    async def connect(host, port):
        return None, W()

    assert (await TcpChecker(80, connect=connect).check("h", 100)).ok


def test_default_factory_builds_tcp():
    c = default_factory().build(CheckConfig(None, CheckType.TCP, {"port": 389}), device())
    assert isinstance(c, TcpChecker)


async def test_monitor_degraded_when_port_check_fails():
    port = free_port()
    mon, store, bus = build(FakeChecker([ok()]), extra=TcpChecker(port))
    d = device(host="127.0.0.1", checks=(CheckConfig(5, CheckType.TCP, {"port": port}),))
    await mon.run_cycle(d)
    assert store.state(1).status is DeviceStatus.DEGRADED
    assert bus.of("domain_event")[-1].message == f"sw1 DEGRADED: tcp/{port} refused"


async def test_tcp_liveness_used_instead_of_ping():
    server = await asyncio.start_server(lambda r, w: w.close(), "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    ping = FakeChecker([fail()])
    mon, store, _ = build(ping, extra=TcpChecker(port))
    try:
        await mon.run_cycle(device(host="127.0.0.1", liveness="tcp", liveness_port=port))
    finally:
        server.close()
        await server.wait_closed()
    assert ping.calls == 0
    assert store.state(1).status is DeviceStatus.UP
