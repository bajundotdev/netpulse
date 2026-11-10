from collections.abc import Callable

from app.domain.models import CheckConfig, CheckType, DeviceConfig
from app.monitoring.checkers.base import Checker
from app.monitoring.checkers.ping import PingChecker

Builder = Callable[[CheckConfig, DeviceConfig], Checker]


class CheckerFactory:
    def __init__(self) -> None:
        self._builders: dict[CheckType, Builder] = {}

    def register(self, type: CheckType, builder: Builder) -> None:
        self._builders[type] = builder

    def build(self, check: CheckConfig, device: DeviceConfig) -> Checker:
        builder = self._builders.get(check.type)
        if builder is None:
            raise ValueError(f"unknown check type: {check.type}")
        return builder(check, device)


def default_factory() -> CheckerFactory:
    factory = CheckerFactory()
    factory.register(CheckType.PING, lambda check, device: PingChecker())
    return factory
