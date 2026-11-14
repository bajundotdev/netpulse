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


class InvalidSecret(ValueError):
    """The auth secret (or header name/username) cannot be sent safely; carries no secret text."""


AUTH_INVALID_REASON = "auth: invalid secret"


def header_safe(value: str, *, token: bool = False) -> bool:
    """True when the value can be sent as (part of) an HTTP header value.

    h11 accepts visible characters with spaces or tabs only between them: no leading or
    trailing whitespace, no CR, LF, NUL or other control characters. On top of that only
    printable ASCII is allowed (tabs are not), and a token (bearer) has no spaces at all.
    """
    if not value or value != value.strip(" "):
        return False
    low = 0x21 if token else 0x20
    return all(low <= ord(ch) <= 0x7E for ch in value)


def _b64(text: str) -> str:
    return base64.b64encode(text.encode("utf-8", "replace")).decode()


def scrub(text: str, secret: str | None, username: str | None = None) -> str:
    """Last line of defence: remove the secret and its encoded forms from a message.

    Covers the secret itself, base64(secret) and the basic-auth header form
    base64("{username}:{secret}") (also with an empty username).
    """
    if not secret:
        return text
    forms = {secret, _b64(secret), _b64(f":{secret}"), _b64(f"{username or ''}:{secret}")}
    for form in sorted(forms, key=len, reverse=True):
        text = text.replace(form, "***")
    return text


_OPAQUE_ERRORS = (httpx2.ProtocolError, UnicodeError, ValueError, TypeError)


def _error_reason(exc: Exception, secret: str | None = None, username: str | None = None) -> str:
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
    if isinstance(exc, _OPAQUE_ERRORS):
        # Their text can embed the request headers (and so the auth secret).
        return f"error: {type(exc).__name__}"
    return scrub(f"error: {exc}", secret, username)


def check_error_reason(exc: Exception, params: dict, secret: str | None) -> str:
    """Failure reason for an exception that escaped an HTTP check (opaque/scrub policy)."""
    auth = params.get("auth") or {}
    return _error_reason(exc, secret, str(auth.get("username") or ""))


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
        self._username = str((params.get("auth") or {}).get("username") or "")
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
            username = str(auth.get("username") or "")
            header_name = str(auth.get("header_name") or "")
            if kind == "bearer" and not header_safe(self._secret, token=True):
                raise InvalidSecret
            if kind == "header" and not header_safe(self._secret):
                raise InvalidSecret
            if kind == "basic" and username and not header_safe(username):
                raise InvalidSecret
            if kind == "header" and header_name and not header_safe(header_name, token=True):
                raise InvalidSecret
            if kind == "bearer":
                headers["Authorization"] = f"Bearer {self._secret}"
            elif kind == "basic":
                raw = f"{username}:{self._secret}".encode()
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

    async def _collect_cert(
        self, task: "asyncio.Task[tuple[str | None, int | None]] | None", deadline: float
    ) -> tuple[str | None, int | None]:
        """The handshake started alongside the request, bounded by what is left of the budget."""
        if task is None:
            return None, None
        remaining = max(0.0, deadline - asyncio.get_running_loop().time())
        done, _ = await asyncio.wait({task}, timeout=remaining)
        if task in done:
            return task.result()
        return None, None

    async def check(self, host: str, timeout_ms: int) -> CheckResult:
        label = self.label
        p = self._p
        client = self._pool.get(
            bool(p.get("verify_tls", True)), bool(p.get("follow_redirects", True))
        )
        need_body = bool(p.get("keyword") or p.get("json"))
        body = p.get("body")
        try:
            headers = self._headers()
        except InvalidSecret:
            return CheckResult(CheckType.HTTP, label, False, reason=AUTH_INVALID_REASON)
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout_ms / 1000
        # The certificate is read whether or not the request succeeds (an expired certificate
        # fails the request before it could be read afterwards), concurrently, and always inside
        # this check's time budget.
        cert_task = asyncio.ensure_future(self._cert(timeout_ms)) if self._wants_cert() else None
        try:
            return await self._request(
                client, headers, body, need_body, timeout_ms, deadline, cert_task
            )
        finally:
            if cert_task is not None and not cert_task.done():
                cert_task.cancel()
                await asyncio.gather(cert_task, return_exceptions=True)

    def _wants_cert(self) -> bool:
        return self._certs is not None and urlsplit(self._url).scheme == "https"

    async def _request(
        self, client, headers, body, need_body, timeout_ms, deadline, cert_task
    ) -> CheckResult:
        label, p = self.label, self._p
        started = self._clock()
        try:
            async with asyncio.timeout(timeout_ms / 1000):
                async with client.stream(
                    self._method,
                    self._url,
                    headers=headers,
                    content=body.encode() if isinstance(body, str) else None,
                    timeout=timeout_ms / 1000,
                ) as response:
                    data = await _read_capped(response) if need_body else b""
                    elapsed_ms = (self._clock() - started) * 1000
                    status, final_url = response.status_code, str(response.url)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            reason = _error_reason(e, self._secret, self._username)
            cert_expires, cert_days = await self._collect_cert(cert_task, deadline)
            value = None
            if cert_expires is not None:
                value = {
                    "status_code": None,
                    "elapsed_ms": None,
                    "cert_expires": cert_expires,
                    "cert_days": cert_days,
                    "final_url": None,
                }
            return CheckResult(CheckType.HTTP, label, False, reason=reason, value=value)

        cert_expires, cert_days = await self._collect_cert(cert_task, deadline)
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
