import asyncio
import base64
import socket
import ssl
import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any, Protocol
from urllib.parse import urlsplit

import httpx2

from app.domain.models import CheckResult, CheckType

MAX_BODY_BYTES = 1024 * 1024
DEFAULT_SLOW_MS = 2000
USER_AGENT = "NetPulse/1.0"


class _Missing:
    def __repr__(self) -> str:
        return "MISSING"


MISSING = _Missing()


class CertReader(Protocol):
    async def expiry(self, host: str, port: int, timeout_ms: int) -> datetime | None: ...


class HttpClientPool:
    """One shared AsyncClient per (verify_tls, follow_redirects). Honours the OS trust store
    and HTTP(S)_PROXY (httpx2 defaults)."""

    def __init__(self, transport: httpx2.AsyncBaseTransport | None = None) -> None:
        self._transport = transport
        self._clients: dict[tuple[bool, bool], httpx2.AsyncClient] = {}

    def get(self, verify_tls: bool, follow_redirects: bool) -> httpx2.AsyncClient:
        key = (verify_tls, follow_redirects)
        client = self._clients.get(key)
        if client is None:
            client = httpx2.AsyncClient(
                verify=verify_tls, follow_redirects=follow_redirects, transport=self._transport
            )
            self._clients[key] = client
        return client

    async def aclose(self) -> None:
        clients, self._clients = list(self._clients.values()), {}
        for client in clients:
            await client.aclose()


def parse_expect_status(spec: str) -> list[tuple[int, int]]:
    ranges: list[tuple[int, int]] = []
    for part in str(spec).split(","):
        part = part.strip()
        if not part:
            continue
        lo, sep, hi = part.partition("-")
        try:
            low = int(lo)
            high = int(hi) if sep else low
        except ValueError:
            raise ValueError(f"invalid status range: {part!r}") from None
        if low > high:
            raise ValueError(f"invalid status range: {part!r}")
        ranges.append((low, high))
    if not ranges:
        raise ValueError("empty expect_status")
    return ranges


def json_lookup(obj: Any, path: str) -> Any:
    cur = obj
    for key in path.split("."):
        if isinstance(cur, dict) and key in cur:
            cur = cur[key]
        elif isinstance(cur, list) and key.isdigit() and int(key) < len(cur):
            cur = cur[int(key)]
        else:
            return MISSING
    return cur


def _number(v: Any) -> float | None:
    if isinstance(v, bool):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def json_compare(actual: Any, op: str, value: Any) -> bool:
    if op == "exists":
        return actual is not MISSING
    if actual is MISSING:
        return False
    if op in ("==", "!="):
        equal = actual == value
        if not equal and not isinstance(actual, str | bool) and not isinstance(value, bool):
            a, b = _number(actual), _number(value)
            equal = a is not None and a == b
        return equal if op == "==" else not equal
    a, b = _number(actual), _number(value)
    if a is None or b is None:
        return False
    return {">": a > b, ">=": a >= b, "<": a < b, "<=": a <= b}[op]


def _chain(exc: BaseException):
    seen = set()
    while exc is not None and id(exc) not in seen:
        seen.add(id(exc))
        yield exc
        exc = exc.__cause__ or exc.__context__


def _error_reason(exc: Exception) -> str:
    if isinstance(exc, httpx2.TimeoutException | TimeoutError):
        return "timeout"
    if isinstance(exc, httpx2.TooManyRedirects):
        return "too many redirects"
    for e in _chain(exc):
        if isinstance(e, ssl.SSLError):
            detail = getattr(e, "verify_message", None) or (e.args[-1] if e.args else e)
            return f"tls: {detail}"
        if isinstance(e, socket.gaierror):
            return "dns"
    if isinstance(exc, httpx2.ConnectError):
        return "refused"
    return f"error: {exc}"


async def _read_capped(response: httpx2.Response) -> bytes:
    body = bytearray()
    async for chunk in response.aiter_bytes():
        body += chunk
        if len(body) >= MAX_BODY_BYTES:
            break
    return bytes(body[:MAX_BODY_BYTES])


class HttpChecker:
    def __init__(
        self,
        params: dict,
        secret: str | None,
        client_pool: HttpClientPool,
        cert_reader: CertReader | None = None,
        clock: Callable[[], float] = time.perf_counter,
    ) -> None:
        self._p = params
        self._secret = secret
        self._pool = client_pool
        self._certs = cert_reader
        self._clock = clock
        self._url = str(params["url"])
        self._method = str(params.get("method") or "GET").upper()
        self._ranges = parse_expect_status(params.get("expect_status") or "200-399")

    @property
    def label(self) -> str:
        name = self._p.get("name")
        if name:
            return str(name)
        return f"{self._method} {urlsplit(self._url).path or '/'}"

    def _headers(self) -> dict[str, str]:
        headers = {"User-Agent": USER_AGENT}
        headers.update({str(k): str(v) for k, v in (self._p.get("headers") or {}).items()})
        auth = self._p.get("auth")
        if auth and self._secret:
            kind = auth.get("type")
            if kind == "bearer":
                headers["Authorization"] = f"Bearer {self._secret}"
            elif kind == "basic":
                raw = f"{auth.get('username') or ''}:{self._secret}".encode()
                headers["Authorization"] = "Basic " + base64.b64encode(raw).decode()
            elif kind == "header" and auth.get("header_name"):
                headers[str(auth["header_name"])] = self._secret
        return headers

    def _status_ok(self, code: int) -> bool:
        return any(lo <= code <= hi for lo, hi in self._ranges)

    async def _cert(self, timeout_ms: int) -> tuple[str | None, int | None]:
        parts = urlsplit(self._url)
        if self._certs is None or parts.scheme != "https" or not parts.hostname:
            return None, None
        try:
            expires = await self._certs.expiry(parts.hostname, parts.port or 443, timeout_ms)
        except Exception:
            return None, None
        if expires is None:
            return None, None
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=UTC)
        return expires.isoformat(), (expires - datetime.now(UTC)).days

    async def check(self, host: str, timeout_ms: int) -> CheckResult:
        label = self.label
        p = self._p
        client = self._pool.get(
            bool(p.get("verify_tls", True)), bool(p.get("follow_redirects", True))
        )
        need_body = bool(p.get("keyword") or p.get("json"))
        body = p.get("body")
        started = self._clock()
        try:
            async with asyncio.timeout(timeout_ms / 1000):
                async with client.stream(
                    self._method,
                    self._url,
                    headers=self._headers(),
                    content=body.encode() if isinstance(body, str) else None,
                    timeout=timeout_ms / 1000,
                ) as response:
                    data = await _read_capped(response) if need_body else b""
                    elapsed_ms = (self._clock() - started) * 1000
                    status, final_url = response.status_code, str(response.url)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            return CheckResult(CheckType.HTTP, label, False, reason=_error_reason(e))

        cert_expires, cert_days = await self._cert(timeout_ms)
        value = {
            "status_code": status,
            "elapsed_ms": elapsed_ms,
            "cert_expires": cert_expires,
            "cert_days": cert_days,
            "final_url": final_url,
        }

        def result(ok: bool, reason: str | None = None, slow: bool = False) -> CheckResult:
            return CheckResult(
                CheckType.HTTP, label, ok, latency_ms=elapsed_ms, reason=reason, value=value,
                slow=slow,
            )

        if not self._status_ok(status):
            return result(False, f"status {status}")
        if (reason := self._assert_body(data)) is not None:
            return result(False, reason)
        slow_ms = p.get("slow_ms") or DEFAULT_SLOW_MS
        if elapsed_ms > slow_ms:
            return result(True, f"slow {round(elapsed_ms)} ms", slow=True)
        return result(True)

    def _assert_body(self, data: bytes) -> str | None:
        kw = self._p.get("keyword")
        if kw:
            found = str(kw["text"]) in data.decode("utf-8", errors="replace")
            if kw.get("mode", "contains") == "absent":
                if found:
                    return "keyword present"
            elif not found:
                return "keyword missing"
        spec = self._p.get("json")
        if spec:
            try:
                import json

                doc = json.loads(data)
            except ValueError:
                return f"json: {spec['path']} is not valid JSON"
            actual = json_lookup(doc, spec["path"])
            if not json_compare(actual, spec.get("op", "=="), spec.get("value")):
                shown = "missing" if actual is MISSING else actual
                return f"json: {spec['path']} is {shown}"
        return None
