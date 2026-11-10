from pathlib import Path

import pytest

from app.monitoring.checkers.ping import PingChecker, parse_ping_output
from app.monitoring.resolve import ResolveError, resolve_host

FIXTURES = Path(__file__).parent / "fixtures"


def load(name: str) -> str:
    return (FIXTURES / name).read_text()


WIN_OK = load("win_ok.txt")
WIN_TIMEOUT = load("win_timeout.txt")
WIN_UNREACHABLE = load("win_unreachable.txt")


def fake_runner(rc: int, output: str):
    async def runner(host: str, timeout_ms: int):
        return rc, output

    return runner


def raising_runner(exc: Exception):
    async def runner(host: str, timeout_ms: int):
        raise exc

    return runner


@pytest.mark.parametrize("fixture,rc,ok,latency", [
    ("win_ok.txt", 0, True, 3.0), ("win_ok_sub1ms.txt", 0, True, 1.0),
    ("win_timeout.txt", 1, False, None), ("win_unreachable.txt", 0, False, None),
    ("mac_ok.txt", 0, True, 2.345)])
def test_parse_ping_output(fixture, rc, ok, latency):
    assert parse_ping_output(rc, load(fixture)) == (ok, latency)


async def test_ping_checker_ok_uses_parsed_latency():
    r = await PingChecker(runner=fake_runner(0, WIN_OK)).check("10.0.0.1", 1000)
    assert r.ok and r.label == "ping" and r.latency_ms == 3.0


async def test_ping_checker_unreachable_reason():
    r = await PingChecker(runner=fake_runner(0, WIN_UNREACHABLE)).check("10.0.0.1", 1000)
    assert not r.ok and r.reason == "unreachable"


async def test_ping_checker_timeout_reason():
    r = await PingChecker(runner=fake_runner(1, WIN_TIMEOUT)).check("10.0.0.1", 1000)
    assert not r.ok and r.reason == "timeout"


async def test_ping_checker_runner_exception_is_failed_result():
    r = await PingChecker(runner=raising_runner(OSError("boom"))).check("10.0.0.1", 1000)
    assert not r.ok and r.reason == "error: boom"


async def test_resolve_host_passes_ip_through():
    assert await resolve_host("192.168.100.11") == "192.168.100.11"


async def test_resolve_host_unknown_name_raises():
    with pytest.raises(ResolveError):
        await resolve_host("no-such-host.invalid")
