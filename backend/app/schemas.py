import ipaddress
import re
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

_HOSTNAME_RE = re.compile(
    r"^(?=.{1,253}$)(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*$"
)
_OID_RE = re.compile(r"^\.?\d+(\.\d+)+$")

DeviceKind = Literal["dc", "server", "switch", "printer", "other"]
Liveness = Literal["ping", "tcp"]
SnmpVersion = Literal["v2c", "v3"]
AuthProto = Literal["none", "MD5", "SHA", "SHA256"]
PrivProto = Literal["none", "DES", "AES128", "AES256"]
CheckKind = Literal["tcp", "snmp_uptime", "snmp_if", "snmp_oid"]
Severity = Literal["info", "warning", "critical"]
ThresholdOp = Literal[">", ">=", "<", "<=", "==", "!="]
SNMP_CHECK_TYPES = frozenset({"snmp_uptime", "snmp_if", "snmp_oid"})


def _check_host(value: str) -> str:
    value = value.strip()
    # A numeric last label ("10.1", "10.0.0.256", "dc01.123") is never a hostname:
    # it must be a valid IP address, or getaddrinfo would expand it to some other host.
    if _HOSTNAME_RE.match(value) and not value.rsplit(".", 1)[-1].isdigit():
        return value
    try:
        ipaddress.ip_address(value)
    except ValueError:
        raise ValueError("host must be an IP address or an RFC 1123 hostname") from None
    return value


Host = Annotated[str, AfterValidator(_check_host)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Port = Annotated[int, Field(ge=1, le=65535)]
Interval = Annotated[int, Field(ge=2, le=3600)]
Threshold = Annotated[int, Field(ge=1, le=10)]
TimeoutMs = Annotated[int, Field(ge=200, le=10000)]


class SnmpIn(BaseModel):
    """SNMP settings. Secrets are write-only: None keeps the stored one, "" clears it."""

    version: SnmpVersion
    port: Port = 161
    community: str | None = None
    user: str | None = None
    auth_proto: AuthProto = "none"
    auth_key: str | None = None
    priv_proto: PrivProto = "none"
    priv_key: str | None = None

    @model_validator(mode="after")
    def _check(self) -> "SnmpIn":
        if self.version == "v3":
            if not self.user:
                raise ValueError("SNMPv3 requires a user")
            for name in ("auth_key", "priv_key"):
                key = getattr(self, name)
                if key and len(key) < 8:
                    raise ValueError(f"{name} must be at least 8 characters")
            if self.priv_proto != "none" and self.auth_proto == "none":
                raise ValueError("priv_proto requires auth_proto")
        return self


class SnmpOut(BaseModel):
    version: SnmpVersion
    port: int
    user: str | None
    auth_proto: str
    priv_proto: str
    has_community: bool
    has_auth_key: bool
    has_priv_key: bool


def _is_number(v: Any) -> bool:
    return isinstance(v, int | float) and not isinstance(v, bool)


def _normalize_params(kind: str, params: dict[str, Any]) -> dict[str, Any]:
    if kind == "tcp":
        port = params.get("port")
        if not isinstance(port, int) or isinstance(port, bool) or not 1 <= port <= 65535:
            raise ValueError("tcp check needs params.port in 1-65535")
        return {"port": port}
    if kind == "snmp_uptime":
        return {}
    if kind == "snmp_if":
        idx = params.get("if_indexes")
        if idx is None:
            return {}
        if not isinstance(idx, list) or not all(
            isinstance(i, int) and not isinstance(i, bool) and i >= 0 for i in idx
        ):
            raise ValueError("params.if_indexes must be a list of non-negative integers")
        return {"if_indexes": idx}
    oid = params.get("oid")
    if not isinstance(oid, str) or not _OID_RE.match(oid):
        raise ValueError("params.oid must be a dotted numeric OID")
    label = params.get("label") or oid
    if not isinstance(label, str):
        raise ValueError("params.label must be a string")
    mode = params.get("mode", "change")
    if mode == "change":
        return {"oid": oid, "label": label, "mode": "change"}
    if mode != "threshold":
        raise ValueError("params.mode must be 'change' or 'threshold'")
    op, value = params.get("op"), params.get("value")
    if op not in (">", ">=", "<", "<=", "==", "!="):
        raise ValueError("threshold mode needs params.op")
    if not _is_number(value):
        raise ValueError("threshold mode needs a numeric params.value")
    return {"oid": oid, "label": label, "mode": "threshold", "op": op, "value": value}


class CheckIn(BaseModel):
    type: CheckKind
    params: dict[str, Any] = Field(default_factory=dict)
    enabled: bool = True

    @model_validator(mode="after")
    def _normalize(self) -> "CheckIn":
        self.params = _normalize_params(self.type, self.params)
        return self


class CheckOut(BaseModel):
    id: int
    device_id: int
    type: str
    params: dict[str, Any]
    enabled: bool
    created_at: datetime


def validate_timing(interval_s: int, timeout_ms: int) -> None:
    if timeout_ms >= interval_s * 1000:
        raise ValueError("timeout_ms must be below interval_s * 1000")


def validate_liveness(liveness: str, port: int | None) -> None:
    if liveness == "tcp" and port is None:
        raise ValueError("liveness 'tcp' requires liveness_port")


class DeviceIn(BaseModel):
    name: Name
    host: Host
    kind: DeviceKind = "other"
    enabled: bool = True
    interval_s: Interval = 5
    fail_threshold: Threshold = 2
    timeout_ms: TimeoutMs = 1000
    liveness: Liveness = "ping"
    liveness_port: Port | None = None
    snmp: SnmpIn | None = None
    notes: str | None = None
    checks: list[CheckIn] = Field(default_factory=list)

    @model_validator(mode="after")
    def _cross_check(self) -> "DeviceIn":
        validate_timing(self.interval_s, self.timeout_ms)
        validate_liveness(self.liveness, self.liveness_port)
        if self.snmp is None:
            if any(c.type in SNMP_CHECK_TYPES for c in self.checks):
                raise ValueError("SNMP checks require snmp settings")
        else:
            s = self.snmp
            if s.version == "v2c" and not s.community:
                raise ValueError("SNMPv2c requires a community")
            if s.version == "v3":
                if s.auth_proto != "none" and not s.auth_key:
                    raise ValueError("auth_proto requires auth_key")
                if s.priv_proto != "none" and not s.priv_key:
                    raise ValueError("priv_proto requires priv_key")
        return self


class DeviceUpdate(BaseModel):
    """Partial update; only fields present in the request are applied."""

    name: Name | None = None
    host: Host | None = None
    kind: DeviceKind | None = None
    enabled: bool | None = None
    interval_s: Interval | None = None
    fail_threshold: Threshold | None = None
    timeout_ms: TimeoutMs | None = None
    liveness: Liveness | None = None
    liveness_port: Port | None = None
    snmp: SnmpIn | None = None
    notes: str | None = None


class DeviceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    host: str
    kind: str
    enabled: bool
    interval_s: int
    fail_threshold: int
    timeout_ms: int
    liveness: str
    liveness_port: int | None
    snmp: SnmpOut | None
    notes: str | None
    checks: list[CheckOut]
    created_at: datetime
    updated_at: datetime


class ResultOut(BaseModel):
    type: str
    label: str
    ok: bool
    check_id: int | None = None
    latency_ms: float | None = None
    reason: str | None = None
    value: Any = None


class DeviceStatusOut(BaseModel):
    device_id: int
    name: str
    status: str
    since: datetime | None
    consecutive_failures: int
    results: list[ResultOut]
    latency: list[float | None]


class EventOut(BaseModel):
    id: int
    ts: datetime
    device_id: int | None
    check_id: int | None
    severity: Severity
    kind: str
    message: str
    status: str | None
    previous_status: str | None
    acknowledged: bool
