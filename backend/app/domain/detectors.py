import operator
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
        """One event per crossing of the certificate's warning threshold (https checks only)."""
        url = urlsplit(str(check.params.get("url") or ""))
        value = result.value
        days = value.get("cert_days") if isinstance(value, dict) else None
        if url.scheme != "https" or not url.hostname or not isinstance(days, int):
            return []  # unknown expiry keeps the previous baseline
        warn = check.params.get("cert_warn_days")
        zone = _cert_zone(days, DEFAULT_CERT_WARN_DAYS if warn is None else int(warn))
        self._state[key] = zone
        if zone == prev or (prev is None and zone == "ok"):
            return []
        subject = f"{name} cert for {url.hostname}"
        if zone == "expired":
            return [event(Severity.CRITICAL, EventKind.CERT_EXPIRY, f"{subject} expired")]
        if zone == "warn":
            msg = f"{subject} expires in {days} days"
            return [event(Severity.WARNING, EventKind.CERT_EXPIRY, msg)]
        return [event(Severity.INFO, EventKind.CERT_EXPIRY, f"{subject} renewed ({days} days)")]
