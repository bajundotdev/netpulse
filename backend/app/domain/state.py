from dataclasses import dataclass
from datetime import datetime

from app.domain.models import (
    CheckResult,
    DeviceStatus,
    DomainEvent,
    EventKind,
    Severity,
)

_SEVERITY = {
    DeviceStatus.DOWN: Severity.CRITICAL,
    DeviceStatus.DEGRADED: Severity.WARNING,
}


@dataclass(frozen=True)
class DeviceState:
    status: DeviceStatus
    consecutive_failures: int
    since: datetime

    @classmethod
    def initial(cls, now: datetime) -> "DeviceState":
        return cls(DeviceStatus.UNKNOWN, 0, now)


def _transition(
    prev: DeviceState,
    status: DeviceStatus,
    failures: int,
    message: str,
    device_id: int,
    now: datetime,
) -> tuple[DeviceState, DomainEvent | None]:
    if status is prev.status:
        return DeviceState(status, failures, prev.since), None
    event = DomainEvent(
        device_id=device_id,
        severity=_SEVERITY.get(status, Severity.INFO),
        kind=EventKind.STATUS_CHANGE,
        message=message,
        status=status.value,
        previous_status=prev.status.value,
        ts=now,
    )
    return DeviceState(status, failures, now), event


def next_state(
    prev: DeviceState,
    name: str,
    device_id: int,
    liveness: CheckResult,
    others: list[CheckResult],
    threshold: int,
    now: datetime,
) -> tuple[DeviceState, DomainEvent | None]:
    if liveness.ok:
        failing = [r for r in others if not r.ok]
        if failing:
            detail = ", ".join(f"{r.label} {r.reason}" for r in failing)
            return _transition(
                prev, DeviceStatus.DEGRADED, 0, f"{name} DEGRADED: {detail}", device_id, now
            )
        return _transition(prev, DeviceStatus.UP, 0, f"{name} UP", device_id, now)

    failures = prev.consecutive_failures + 1
    if failures >= threshold:
        message = f"{name} DOWN ({liveness.label}: {liveness.reason})"
        return _transition(prev, DeviceStatus.DOWN, failures, message, device_id, now)
    return DeviceState(prev.status, failures, prev.since), None


def paused_state(
    prev: DeviceState, name: str, device_id: int, now: datetime
) -> tuple[DeviceState, DomainEvent | None]:
    return _transition(prev, DeviceStatus.PAUSED, 0, f"{name} PAUSED", device_id, now)
