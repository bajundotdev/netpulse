from typing import Protocol

from app.domain.models import CheckResult


class Checker(Protocol):
    async def check(self, host: str, timeout_ms: int) -> CheckResult: ...
