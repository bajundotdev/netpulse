import asyncio
import time
from collections.abc import Awaitable, Callable

from app.domain.models import CheckResult, CheckType

Connect = Callable[[str, int], Awaitable[tuple[asyncio.StreamReader, asyncio.StreamWriter]]]


class TcpChecker:
    def __init__(self, port: int, connect: Connect = asyncio.open_connection) -> None:
        self._port = port
        self._connect = connect

    async def check(self, host: str, timeout_ms: int) -> CheckResult:
        label = f"tcp/{self._port}"
        started = time.perf_counter()
        try:
            _, writer = await asyncio.wait_for(
                self._connect(host, self._port), timeout_ms / 1000
            )
        except (asyncio.TimeoutError, TimeoutError):
            return CheckResult(CheckType.TCP, label, False, reason="timeout")
        except ConnectionRefusedError:
            return CheckResult(CheckType.TCP, label, False, reason="refused")
        except OSError as e:
            return CheckResult(CheckType.TCP, label, False, reason=f"error: {e}")
        latency = (time.perf_counter() - started) * 1000
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass
        return CheckResult(CheckType.TCP, label, True, latency_ms=latency)
