import ipaddress
import re
from datetime import datetime
from typing import Annotated, Any, Literal
from urllib.parse import urlsplit

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_serializer,
    field_validator,
    StringConstraints,
    model_validator,
)

from app.monitoring.checkers.http import header_safe, parse_expect_status

_HOSTNAME_RE = re.compile(
    r"^(?=.{1,253}$)(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*$"
)
_OID_RE = re.compile(r"^\.?\d+(\.\d+)+$")

DeviceKind = Literal["dc", "server", "switch", "printer", "other", "web"]
Liveness = Literal["ping", "tcp", "http"]
SnmpVersion = Literal["v2c", "v3"]
AuthProto = Literal["none", "MD5", "SHA", "SHA256"]
PrivProto = Literal["none", "DES", "AES128", "AES256"]
CheckKind = Literal["tcp", "snmp_uptime", "snmp_if", "snmp_oid", "http"]
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


def _check_url(value: str) -> str:
    value = value.strip()
    if len(value) > 2048 or any(ch.isspace() or ord(ch) < 0x20 for ch in value):
        raise ValueError("url must be a single http(s) URL of at most 2048 characters")
    try:
        parts = urlsplit(value)
        parts.port  # noqa: B018 - raises ValueError for an invalid port
    except ValueError:
        raise ValueError("url is not valid") from None
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ValueError("url must start with http:// or https:// and name a host")
    if parts.username is not None or parts.password is not None:
        raise ValueError("url must not contain credentials; use the auth settings")
    return value


def url_host(url: str) -> str | None:
    """The URL's hostname (lower-case, no port), or None when it has none."""
    try:
        return urlsplit(url).hostname
    except ValueError:
        return None


Host = Annotated[str, AfterValidator(_check_host)]
Url = Annotated[str, AfterValidator(_check_url)]
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


_HEADER_NAME_RE = re.compile(r"^[A-Za-z0-9!#$%&'*+.^_`|~-]+$")
HttpMethod = Literal["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]
JsonOp = Literal["==", "!=", ">", ">=", "<", "<=", "exists"]


def _header_text_ok(value: str) -> bool:
    return all(0x20 <= ord(ch) <= 0x7E for ch in value)


class HttpKeyword(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    mode: Literal["contains", "absent"] = "contains"


class HttpJson(BaseModel):
    path: str = Field(min_length=1, max_length=200)
    op: JsonOp = "=="
    value: Any = None


class HttpAuth(BaseModel):
    """How the write-only secret is sent; the secret itself is never part of params."""

    type: Literal["bearer", "basic", "header"]
    username: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None = None
    header_name: Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)] | None = None

    @model_validator(mode="after")
    def _check(self) -> "HttpAuth":
        if self.type == "header":
            if not self.header_name or not _HEADER_NAME_RE.match(self.header_name):
                raise ValueError("auth type 'header' needs a valid header_name")
            self.username = None
        elif self.type == "basic":
            self.header_name = None
        else:
            self.username = self.header_name = None
        if self.username is not None and not _header_text_ok(self.username):
            raise ValueError("auth username must be printable ASCII")
        return self


class HttpParams(BaseModel):
    """Parameters of an `http` check (spec 3.2). Unknown keys are dropped."""

    url: Url
    method: HttpMethod = "GET"
    headers: dict[str, str] = Field(default_factory=dict)
    body: str | None = Field(default=None, max_length=100_000)
    expect_status: str = "200-399"
    keyword: HttpKeyword | None = None
    json_check: HttpJson | None = Field(default=None, alias="json")
    slow_ms: int = Field(default=2000, ge=1, le=600_000)
    cert_warn_days: int = Field(default=14, ge=0, le=3650)
    verify_tls: bool = True
    follow_redirects: bool = True
    auth: HttpAuth | None = None
    name: Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)] | None = None

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("method", mode="before")
    @classmethod
    def _upper(cls, v: Any) -> Any:
        return v.strip().upper() if isinstance(v, str) else v

    @field_validator("headers")
    @classmethod
    def _headers(cls, v: dict[str, str]) -> dict[str, str]:
        for name, value in v.items():
            if not _HEADER_NAME_RE.match(name) or not _header_text_ok(value):
                raise ValueError("headers must have token names and printable ASCII values")
        return v

    @field_validator("expect_status")
    @classmethod
    def _status(cls, v: str) -> str:
        ranges = parse_expect_status(v)
        if any(lo < 100 or hi > 599 for lo, hi in ranges):
            raise ValueError("expect_status codes must be within 100-599")
        return ",".join(f"{lo}" if lo == hi else f"{lo}-{hi}" for lo, hi in ranges)


def _http_params(params: dict[str, Any]) -> dict[str, Any]:
    try:
        model = HttpParams.model_validate(params)
    except ValidationError as exc:
        # Compact message: ValidationError's own text would echo the offending input.
        detail = "; ".join(
            f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" if e["loc"] else e["msg"]
            for e in exc.errors(include_input=False, include_url=False)
        )
        raise ValueError(f"invalid http params ({detail})") from None
    out = model.model_dump(exclude_none=True, exclude_unset=True)
    if model.json_check is not None:
        out["json"] = out.pop("json_check")
    out["method"] = model.method
    out["expect_status"] = model.expect_status
    return out


def _normalize_params(kind: str, params: dict[str, Any]) -> dict[str, Any]:
    if kind == "http":
        return _http_params(params)
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
    """A check. `secret` (HTTP auth token/password/header value) is write-only:
    None keeps the stored one, "" clears it."""

    type: CheckKind
    params: dict[str, Any] = Field(default_factory=dict)
    enabled: bool = True
    secret: str | None = Field(default=None, max_length=4096)

    @field_validator("secret")
    @classmethod
    def _strip_secret(cls, v: str | None) -> str | None:
        # Pasted tokens often carry a trailing space or newline; a blank one is no secret.
        return v.strip() if v is not None else None

    @model_validator(mode="after")
    def _normalize(self) -> "CheckIn":
        self.params = _normalize_params(self.type, self.params)
        if self.secret and (self.type != "http" or not self.params.get("auth")):
            raise ValueError("a secret needs an http check with params.auth")
        if self.secret:
            # Fixed messages: the secret itself is never echoed. Basic passwords are base64-encoded
            # into the header, so any characters are fine there.
            kind = self.params["auth"]["type"]
            if kind == "bearer" and not header_safe(self.secret, token=True):
                raise ValueError("Token contains characters that cannot be sent in an HTTP header")
            if kind == "header" and not header_safe(self.secret):
                raise ValueError(
                    "Header value contains characters that cannot be sent in an HTTP header"
                )
        return self


class CheckOut(BaseModel):
    id: int
    device_id: int
    type: str
    params: dict[str, Any]
    enabled: bool
    has_secret: bool = False
    created_at: datetime


def validate_timing(interval_s: int, timeout_ms: int) -> None:
    if timeout_ms >= interval_s * 1000:
        raise ValueError("timeout_ms must be below interval_s * 1000")


def validate_liveness(liveness: str, port: int | None, url: str | None = None) -> None:
    if liveness == "tcp" and port is None:
        raise ValueError("liveness 'tcp' requires liveness_port")
    if liveness == "http" and not url:
        raise ValueError("liveness 'http' requires a url")


def validate_web(kind: str, liveness: str, url: str | None) -> None:
    if kind == "web":
        if not url:
            raise ValueError("a website / API device requires a url")
        if liveness != "http":
            raise ValueError("a website / API device requires liveness 'http'")


# Defaults by device kind: (interval_s, timeout_ms)
KIND_TIMING = {"web": (30, 10000)}
DEFAULT_TIMING = (5, 1000)


class DeviceIn(BaseModel):
    name: Name
    host: Host | None = None  # derived from the url for kind "web"
    kind: DeviceKind = "other"
    url: Url | None = None
    enabled: bool = True
    interval_s: Interval | None = None  # 5 (web: 30)
    fail_threshold: Threshold = 2
    timeout_ms: TimeoutMs | None = None  # 1000 (web: 10000)
    liveness: Liveness = "ping"  # web: "http"
    liveness_port: Port | None = None
    snmp: SnmpIn | None = None
    notes: str | None = None
    checks: list[CheckIn] = Field(default_factory=list)

    @model_validator(mode="after")
    def _cross_check(self) -> "DeviceIn":
        default_interval, default_timeout = KIND_TIMING.get(self.kind, DEFAULT_TIMING)
        if self.interval_s is None:
            self.interval_s = default_interval
        if self.timeout_ms is None:
            self.timeout_ms = default_timeout
        if self.kind == "web" and "liveness" not in self.model_fields_set:
            self.liveness = "http"
        validate_web(self.kind, self.liveness, self.url)
        if not self.host:
            host = url_host(self.url) if self.kind == "web" and self.url else None
            if host is None:
                raise ValueError("host is required")
            self.host = _check_host(host)
        validate_timing(self.interval_s, self.timeout_ms)
        validate_liveness(self.liveness, self.liveness_port, self.url)
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
    url: Url | None = None
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
    url: str | None
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
    slow: bool = False  # ok, but slower than the check's slow_ms


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


class DeviceHistoryOut(BaseModel):
    device_id: int
    buckets: list[str | None]
    uptime_pct: float | None


class OverallHistoryOut(BaseModel):
    problems: list[int]
    status: list[str | None]


class HistoryOut(BaseModel):
    range: str
    start: datetime
    end: datetime
    bucket_seconds: int
    problems_last_hour: int
    overall: OverallHistoryOut
    devices: list[DeviceHistoryOut]

    @field_serializer("start", "end")
    def _iso_offset(self, value: datetime) -> str:
        # "+00:00" rather than pydantic's default "Z", as in the API contract.
        return value.isoformat()
