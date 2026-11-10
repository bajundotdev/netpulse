import asyncio
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from typing import Any


class DbRunner:
    """Runs blocking database calls on one dedicated thread, so slow DNS lookups in the
    default executor can never delay event persistence or API reads."""

    def __init__(self) -> None:
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="netpulse-db")

    async def __call__(self, fn: Callable[..., Any], /, *args: Any) -> Any:
        return await asyncio.get_running_loop().run_in_executor(self._pool, partial(fn, *args))

    def shutdown(self) -> None:
        self._pool.shutdown(wait=True)
