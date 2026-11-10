from collections.abc import Callable

from app.domain.models import CheckConfig, CheckType, DeviceConfig
from app.monitoring.checkers.base import Checker
from app.monitoring.checkers.ping import PingChecker
from app.monitoring.checkers.snmp import SnmpIfChecker, SnmpOidChecker, SnmpUptimeChecker
from app.monitoring.checkers.tcp import TcpChecker
from app.monitoring.snmp_client import PysnmpClient, SnmpClient

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


def default_factory(snmp_client: SnmpClient | None = None) -> CheckerFactory:
    factory = CheckerFactory()
    shared: list[SnmpClient] = [snmp_client] if snmp_client is not None else []

    def client() -> SnmpClient:
        if not shared:
            shared.append(PysnmpClient())
        return shared[0]

    def settings(device: DeviceConfig):
        if device.snmp is None:
            raise ValueError("device has no SNMP settings")
        return device.snmp

    def oid_checker(check: CheckConfig, device: DeviceConfig) -> Checker:
        p = check.params
        return SnmpOidChecker(
            settings(device), client(), str(p["oid"]), str(p.get("label") or p["oid"]),
            str(p["mode"]), p.get("op"), p.get("value"),
        )

    factory.register(CheckType.PING, lambda check, device: PingChecker())
    factory.register(CheckType.TCP, lambda check, device: TcpChecker(int(check.params["port"])))
    factory.register(
        CheckType.SNMP_UPTIME, lambda check, device: SnmpUptimeChecker(settings(device), client())
    )
    factory.register(
        CheckType.SNMP_IF,
        lambda check, device: SnmpIfChecker(
            settings(device), client(), check.params.get("if_indexes")
        ),
    )
    factory.register(CheckType.SNMP_OID, oid_checker)
    return factory
