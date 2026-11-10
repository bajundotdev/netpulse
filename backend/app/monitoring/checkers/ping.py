import asyncio
import os
import re
import time
from collections.abc import Awaitable, Callable

from app.domain.models import CheckResult, CheckType

_LATENCY_RE = re.compile(r"time([=<])\s*([\d.]+)\s*ms", re.IGNORECASE)


def parse_ping_output(returncode: int, output: str) -> tuple[bool, float | None]:
    """Windows ping exits 0 on 'Destination host unreachable', so require a TTL= reply."""
    ok = returncode == 0 and "TTL=" in output.upper()
    if not ok:
        return False, None
    match = _LATENCY_RE.search(output)
    if match is None:
        return True, None
    if match.group(1) == "<":
        return True, 1.0
    return True, float(match.group(2))


async def run_ping(host: str, timeout_ms: int) -> tuple[int, str]:
    if os.name == "nt":
        args = ["ping", "-n", "1", "-w", str(timeout_ms), host]
        encoding = "oem"
    else:
        args = ["ping", "-c", "1", host]
        encoding = "utf-8"
    proc = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
    )
    try:
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout_ms / 1000 + 1)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return 1, ""
    return proc.returncode, stdout.decode(encoding, errors="replace")


class PingChecker:
    def __init__(self, runner: Callable[[str, int], Awaitable[tuple[int, str]]] = run_ping):
        self._runner = runner

    async def check(self, host: str, timeout_ms: int) -> CheckResult:
        start = time.perf_counter()
        try:
            returncode, output = await self._runner(host, timeout_ms)
        except Exception as e:
            return CheckResult(CheckType.PING, "ping", False, reason=f"error: {e}")
        wall_ms = (time.perf_counter() - start) * 1000
        ok, latency = parse_ping_output(returncode, output)
        if ok:
            return CheckResult(CheckType.PING, "ping", True,
                               latency_ms=latency if latency is not None else wall_ms)
        reason = "unreachable" if "unreachable" in output.lower() else "timeout"
        return CheckResult(CheckType.PING, "ping", False, reason=reason)
