import operator
from collections.abc import Sequence
from typing import Any
from urllib.parse import urlsplit

from app.domain.models import (
    CheckConfig,
    CheckResult,
    CheckType,
    DomainEvent,
    EventKind,
    Severity,
)

_OPS = {
    ">": operator.gt,
    ">=": operator.ge,
    "<": operator.lt,
    "<=": operator.le,
    "==": operator.eq,
    "!=": operator.ne,
}


def breaches(op: str, threshold: float, value: float) -> bool:
    return _OPS[op](value, threshold)


def _fmt(v: Any) -> str:
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


DEFAULT_CERT_WARN_DAYS = 14


def _cert_zone(days: int, warn_days: int) -> str:
    if days < 0:
        return "expired"
    return "warn" if days <= warn_days else "ok"


def _https_endpoint(check: CheckConfig) -> tuple[str, int] | None:
    """host:port of an https HTTP check, the key certificate state is kept under."""
    if check.type is not CheckType.HTTP:
        return None
    try:
        url = urlsplit(str(check.params.get("url") or ""))
        port = url.port or 443
    except ValueError:
        return None
    if url.scheme != "https" or not url.hostname:
        return None
    return url.hostname, port


def _number(v: Any) -> float | None:
    if isinstance(v, bool):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


class ChangeTracker:
    """Turns successive SNMP check results into change events (in memory)."""

    def __init__(self) -> None:
        self._state: dict[tuple[int, int | None, CheckType], Any] = {}

    def forget(self, device_id: int) -> None:
        for key in [k for k in self._state if k[0] == device_id]:
            del self._state[key]

    def observe(
        self, device_id: int, name: str, check: CheckConfig, result: CheckResult
    ) -> list[DomainEvent]:
        if result.value is None:
            return []
        key = (device_id, check.id, check.type)
        prev = self._state.get(key)

        def event(severity: Severity, kind: EventKind, message: str) -> DomainEvent:
            return DomainEvent(device_id, severity, kind, message, check_id=check.id)

        if check.type is CheckType.HTTP:
            return self._certificate(key, prev, name, check, result, event)

        if check.type is CheckType.SNMP_UPTIME:
            if not result.ok:
                return []
            self._state[key] = result.value
            if prev is not None and result.value < prev:
                return [event(Severity.CRITICAL, EventKind.REBOOT, f"{name} rebooted")]
            return []

        if check.type is CheckType.SNMP_IF:
            current = {i: v["status"] for i, v in result.value.items()}
            self._state[key] = current
            events = []
            for index, status in current.items():
                old = (prev or {}).get(index)
                if old is None or old == status:
                    continue
                descr = result.value[index]["name"]
                severity = Severity.INFO if status == "up" else Severity.WARNING
                events.append(event(severity, EventKind.IF_CHANGE, f"{name} {descr} {status}"))
            return events

        if check.type is CheckType.SNMP_OID:
            if check.params.get("mode") == "threshold":
                return self._threshold(key, prev, name, check, result, event)
            if not result.ok:
                return []
            self._state[key] = result.value
            if prev is not None and prev != result.value:
                msg = f"{name} {result.label} changed: {_fmt(prev)} → {_fmt(result.value)}"
                return [event(Severity.INFO, EventKind.OID_CHANGE, msg)]
        return []

    def _threshold(self, key, prev, name, check, result, event) -> list[DomainEvent]:
        value = _number(result.value)
        if value is None:
            return []
        op, threshold = check.params["op"], check.params["value"]
        breached = breaches(op, threshold, value)
        self._state[key] = breached
        if prev is None and not breached or prev == breached:
            return []
        if breached:
            msg = f"{name} {result.label} {op} {_fmt(threshold)} (value {_fmt(value)})"
            return [event(Severity.CRITICAL, EventKind.OID_THRESHOLD, msg)]
        msg = f"{name} {result.label} back to normal (value {_fmt(value)})"
        return [event(Severity.INFO, EventKind.OID_THRESHOLD, msg)]

    def _certificate(self, key, prev, name, check, result, event) -> list[DomainEvent]:
        return self.observe_certs(key[0], name, [(check, result)])

    def observe_certs(
        self,
        device_id: int,
        name: str,
        items: list[tuple[CheckConfig, CheckResult]],
        configs: Sequence[CheckConfig] | None = None,
    ) -> list[DomainEvent]:
        """Certificate events from HTTP results (liveness and explicit checks alike).

        State is per device and host:port, so a liveness check and explicit checks on the same
        endpoint share one zone and fire once. The threshold is the smallest cert_warn_days of the
        device's explicit HTTP checks (`configs`, the enabled ones) on that endpoint, else the
        default. It comes from the configs, not from this cycle's results: while liveness fails
        only its result is seen, and the zone must not move because of that. Without `configs`
        the explicit checks among `items` are used.
        """
        if configs is None:
            configs = [check for check, _ in items if check.id is not None]
        warns: dict[tuple[str, int], list[int]] = {}
        check_ids: dict[tuple[str, int], int] = {}
        for check in configs:
            endpoint = _https_endpoint(check)
            if endpoint is None or check.id is None:
                continue
            warn = check.params.get("cert_warn_days")
            warns.setdefault(endpoint, []).append(
                DEFAULT_CERT_WARN_DAYS if warn is None else int(warn)
            )
            check_ids.setdefault(endpoint, check.id)
        groups: dict[tuple[str, int], dict[str, Any]] = {}
        for check, result in items:
            endpoint = _https_endpoint(check)
            if endpoint is None:
                continue
            g = groups.setdefault(
                endpoint,
                {
                    "days": None,
                    "warn": min(warns.get(endpoint, ()), default=DEFAULT_CERT_WARN_DAYS),
                    "check_id": check_ids.get(endpoint),
                },
            )
            value = result.value
            days = value.get("cert_days") if isinstance(value, dict) else None
            if isinstance(days, int) and not isinstance(days, bool) and g["days"] is None:
                g["days"] = days
        events: list[DomainEvent] = []
        for (host, port), g in groups.items():
            days = g["days"]
            if days is None:
                continue  # unknown expiry keeps the previous baseline
            key = (device_id, f"cert:{host}:{port}", CheckType.HTTP)
            zone = _cert_zone(days, g["warn"])
            prev = self._state.get(key)
            self._state[key] = zone
            if zone == prev or (prev is None and zone == "ok"):
                continue
            subject = f"{name} cert for {host}"

            def event(sev: Severity, msg: str) -> DomainEvent:
                return DomainEvent(
                    device_id, sev, EventKind.CERT_EXPIRY, msg, check_id=g["check_id"]
                )

            if zone == "expired":
                events.append(event(Severity.CRITICAL, f"{subject} expired"))
            elif zone == "warn":
                events.append(event(Severity.WARNING, f"{subject} expires in {days} days"))
            else:
                events.append(event(Severity.INFO, f"{subject} renewed ({days} days)"))
        return events
