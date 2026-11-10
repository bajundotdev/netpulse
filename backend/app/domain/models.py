from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any


class DeviceStatus(StrEnum):
    UNKNOWN = "UNKNOWN"
    UP = "UP"
    DEGRADED = "DEGRADED"
    DOWN = "DOWN"
    PAUSED = "PAUSED"


class Severity(StrEnum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


class EventKind(StrEnum):
    STATUS_CHANGE = "status_change"
    REBOOT = "reboot"
    IF_CHANGE = "if_change"
    OID_CHANGE = "oid_change"
    OID_THRESHOLD = "oid_threshold"
    CHECK_ERROR = "check_error"


class CheckType(StrEnum):
    PING = "ping"
    TCP = "tcp"
    SNMP_UPTIME = "snmp_uptime"
    SNMP_IF = "snmp_if"
    SNMP_OID = "snmp_oid"


@dataclass(frozen=True)
class SnmpSettings:
    """Decrypted SNMP credentials; held in memory only."""

    version: str
    port: int = 161
    community: str | None = None
    user: str | None = None
    auth_proto: str = "none"
    auth_key: str | None = None
    priv_proto: str = "none"
    priv_key: str | None = None


@dataclass(frozen=True)
class CheckConfig:
    id: int | None
    type: CheckType
    params: dict
    enabled: bool = True


@dataclass(frozen=True)
class DeviceConfig:
    id: int
    name: str
    host: str
    kind: str = "other"
    enabled: bool = True
    interval_s: int = 5
    fail_threshold: int = 2
    timeout_ms: int = 1000
    liveness: str = "ping"
    liveness_port: int | None = None
    snmp: SnmpSettings | None = None
    checks: tuple[CheckConfig, ...] = ()

    def liveness_check(self) -> CheckConfig:
        if self.liveness == "tcp":
            return CheckConfig(None, CheckType.TCP, {"port": self.liveness_port})
        return CheckConfig(None, CheckType.PING, {})


@dataclass
class CheckResult:
    type: CheckType
    label: str
    ok: bool
    check_id: int | None = None
    latency_ms: float | None = None
    reason: str | None = None
    value: Any = None


@dataclass(frozen=True)
class DomainEvent:
    device_id: int | None
    severity: Severity
    kind: EventKind
    message: str
    check_id: int | None = None
    status: str | None = None
    previous_status: str | None = None
    ts: datetime = field(default_factory=lambda: datetime.now(UTC))
