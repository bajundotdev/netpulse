import asyncio
import time
from typing import Any

from app.domain.detectors import breaches
from app.domain.models import CheckResult, CheckType, SnmpSettings
from app.monitoring.snmp_client import SnmpClient, SnmpError

SYS_UPTIME = "1.3.6.1.2.1.1.3.0"
IF_DESCR = "1.3.6.1.2.1.2.2.1.2"
IF_OPER_STATUS = "1.3.6.1.2.1.2.2.1.8"
_IF_STATUS = {
    1: "up", 2: "down", 3: "testing", 4: "unknown",
    5: "dormant", 6: "notPresent", 7: "lowerLayerDown",
}


def _failure(check_type: CheckType, label: str, e: Exception, started: float) -> CheckResult:
    text = str(e) or type(e).__name__
    return CheckResult(
        check_type, label, False, latency_ms=_ms(started), reason=f"snmp: {text}"
    )


def _ms(started: float) -> float:
    return (time.perf_counter() - started) * 1000


class SnmpUptimeChecker:
    def __init__(self, settings: SnmpSettings, client: SnmpClient) -> None:
        self._settings, self._client = settings, client

    async def check(self, host: str, timeout_ms: int) -> CheckResult:
        label, started = "snmp uptime", time.perf_counter()
        try:
            got = await self._client.get(host, self._settings, [SYS_UPTIME], timeout_ms)
        except (SnmpError, asyncio.TimeoutError, TimeoutError) as e:
            return _failure(CheckType.SNMP_UPTIME, label, e, started)
        return CheckResult(
            CheckType.SNMP_UPTIME, label, True, latency_ms=_ms(started), value=got[SYS_UPTIME]
        )


class SnmpIfChecker:
    def __init__(
        self, settings: SnmpSettings, client: SnmpClient, if_indexes: list[int] | None
    ) -> None:
        self._settings, self._client, self._watched = settings, client, if_indexes

    async def check(self, host: str, timeout_ms: int) -> CheckResult:
        label, started = "interfaces", time.perf_counter()
        try:
            descrs, statuses = await self._fetch(host, timeout_ms)
        except (SnmpError, asyncio.TimeoutError, TimeoutError) as e:
            return _failure(CheckType.SNMP_IF, label, e, started)
        value: dict[int, dict[str, Any]] = {}
        for oid, raw in statuses.items():
            index = int(oid.rsplit(".", 1)[1])
            if self._watched is not None and index not in self._watched:
                continue
            name = str(descrs.get(f"{IF_DESCR}.{index}", f"if{index}"))
            value[index] = {"name": name, "status": _IF_STATUS.get(raw, "unknown")}
        down = [
            v["name"] + " " + v["status"]
            for i, v in value.items()
            if self._watched is not None and v["status"] != "up"
        ]
        return CheckResult(
            CheckType.SNMP_IF, label, not down, latency_ms=_ms(started),
            reason=", ".join(down) or None, value=value,
        )

    async def _fetch(self, host: str, timeout_ms: int) -> tuple[dict[str, Any], dict[str, Any]]:
        if self._watched:
            # Watched interfaces: one GET of exactly ifDescr.N and ifOperStatus.N.
            oids = [f"{col}.{i}" for col in (IF_DESCR, IF_OPER_STATUS) for i in self._watched]
            got = await self._client.get(host, self._settings, oids, timeout_ms)
            descrs = {k: v for k, v in got.items() if k.startswith(IF_DESCR + ".")}
            statuses = {k: v for k, v in got.items() if k.startswith(IF_OPER_STATUS + ".")}
            return descrs, statuses
        # All interfaces: walk both columns at once.
        descrs, statuses = await asyncio.gather(
            self._client.walk(host, self._settings, IF_DESCR, timeout_ms),
            self._client.walk(host, self._settings, IF_OPER_STATUS, timeout_ms),
        )
        return descrs, statuses


class SnmpOidChecker:
    def __init__(
        self,
        settings: SnmpSettings,
        client: SnmpClient,
        oid: str,
        label: str,
        mode: str,
        op: str | None = None,
        value: float | None = None,
    ) -> None:
        self._settings, self._client = settings, client
        self._oid = oid.lstrip(".")
        self._label = f"oid:{label}"
        self._mode, self._op, self._threshold = mode, op, value

    async def check(self, host: str, timeout_ms: int) -> CheckResult:
        started = time.perf_counter()
        try:
            got = await self._client.get(host, self._settings, [self._oid], timeout_ms)
        except (SnmpError, asyncio.TimeoutError, TimeoutError) as e:
            return _failure(CheckType.SNMP_OID, self._label, e, started)
        current = got[self._oid]
        latency = _ms(started)
        if self._mode != "threshold":
            return CheckResult(
                CheckType.SNMP_OID, self._label, True, latency_ms=latency, value=current
            )
        if isinstance(current, bool) or not isinstance(current, (int, float)):
            try:
                number = float(current)
            except (TypeError, ValueError):
                return CheckResult(
                    CheckType.SNMP_OID, self._label, False, latency_ms=latency,
                    reason="not numeric", value=current,
                )
        else:
            number = current
        if breaches(self._op, self._threshold, number):
            return CheckResult(
                CheckType.SNMP_OID, self._label, False, latency_ms=latency,
                reason=f"value {current} {self._op} {self._threshold}", value=current,
            )
        return CheckResult(
            CheckType.SNMP_OID, self._label, True, latency_ms=latency, value=current
        )
