import base64
from datetime import UTC, datetime, timedelta

import httpx2
import pytest

from app.domain.models import CheckResult, CheckType
from app.monitoring.checkers.http import (
    MISSING,
    HttpChecker,
    HttpClientPool,
    json_compare,
    json_lookup,
    parse_expect_status,
)

URL = "https://api.example.com/health"


class Clock:
    """perf_counter stand-in: each call advances by `step` seconds."""

    def __init__(self, step: float = 0.01) -> None:
        self.t = 0.0
        self.step = step

    def __call__(self) -> float:
        self.t += self.step
        return self.t


@pytest.fixture
async def make():
    pools: list[HttpClientPool] = []

    def build(handler, params=None, secret=None, cert_reader=None, clock=None):
        pool = HttpClientPool(transport=httpx2.MockTransport(handler))
        pools.append(pool)
        return HttpChecker(
            {"url": URL, **(params or {})}, secret, pool, cert_reader, clock=clock or Clock()
        )

    yield build
    for p in pools:
        await p.aclose()


def respond(status=200, **kw):
    return lambda request: httpx2.Response(status, **kw)


async def test_ok_with_value(make):
    r = await make(respond(200, text="hi")).check("1.2.3.4", 5000)
    assert isinstance(r, CheckResult) and r.type is CheckType.HTTP
    assert r.ok and not r.slow and r.reason is None
    assert r.value["status_code"] == 200 and r.value["final_url"] == URL
    assert r.value["elapsed_ms"] == pytest.approx(r.latency_ms)
    assert r.value["cert_expires"] is None and r.value["cert_days"] is None
    assert r.label == "GET /health"


async def test_label_from_name(make):
    r = await make(respond(), {"name": "API"}).check("h", 1000)
    assert r.label == "API"


async def test_status_503_fails(make):
    r = await make(respond(503)).check("h", 1000)
    assert not r.ok and r.reason == "status 503" and r.value["status_code"] == 503


def test_parse_expect_status():
    assert parse_expect_status("200,204,301-302") == [(200, 200), (204, 204), (301, 302)]
    assert parse_expect_status("200-399") == [(200, 399)]
    with pytest.raises(ValueError):
        parse_expect_status("abc")


async def test_expect_status_list(make):
    c = make(respond(204), {"expect_status": "200,204,301-302"})
    assert (await c.check("h", 1000)).ok
    c = make(respond(302), {"expect_status": "200,204,301-302", "follow_redirects": False})
    assert (await c.check("h", 1000)).ok
    c = make(respond(404), {"expect_status": "200,204,301-302"})
    assert (await c.check("h", 1000)).reason == "status 404"


async def test_keyword_contains(make):
    p = {"keyword": {"text": "Welcome", "mode": "contains"}}
    assert (await make(respond(text="Welcome home"), p).check("h", 1000)).ok
    r = await make(respond(text="welcome home"), p).check("h", 1000)  # case-sensitive
    assert not r.ok and r.reason == "keyword missing"


async def test_keyword_absent(make):
    p = {"keyword": {"text": "Error", "mode": "absent"}}
    assert (await make(respond(text="all fine"), p).check("h", 1000)).ok
    r = await make(respond(text="an Error occurred"), p).check("h", 1000)
    assert not r.ok and r.reason == "keyword present"


async def test_body_capped_at_1mb(make):
    body = b"a" * (1024 * 1024) + b"NEEDLE"
    p = {"keyword": {"text": "NEEDLE", "mode": "contains"}}
    r = await make(respond(content=body), p).check("h", 5000)
    assert not r.ok and r.reason == "keyword missing"
    body = b"NEEDLE" + b"a" * (1024 * 1024)
    assert (await make(respond(content=body), p).check("h", 5000)).ok


def test_json_lookup():
    obj = {"data": {"items": [{"status": "ok"}, {"status": "bad"}]}, "n": 3}
    assert json_lookup(obj, "data.items.0.status") == "ok"
    assert json_lookup(obj, "data.items.1.status") == "bad"
    assert json_lookup(obj, "n") == 3
    assert json_lookup(obj, "data.items.5") is MISSING
    assert json_lookup(obj, "nope.deeper") is MISSING


@pytest.mark.parametrize(
    "actual,op,value,expected",
    [
        ("ok", "==", "ok", True), ("ok", "==", "no", False),
        ("ok", "!=", "no", True), ("ok", "!=", "ok", False),
        (5, ">", 3, True), (3, ">", 3, False), (3, ">=", 3, True),
        (2, "<", 3, True), (3, "<=", 3, True), (4, "<=", 3, False),
        (5, "exists", None, True), (None, "exists", None, True), (MISSING, "exists", None, False),
        (MISSING, "==", "ok", False), ("abc", ">", 3, False),
    ],
)
def test_json_compare(actual, op, value, expected):
    assert json_compare(actual, op, value) is expected


async def test_json_assertion(make):
    p = {"json": {"path": "data.status", "op": "==", "value": "ok"}}
    assert (await make(respond(json={"data": {"status": "ok"}}), p).check("h", 1000)).ok
    r = await make(respond(json={"data": {"status": "down"}}), p).check("h", 1000)
    assert not r.ok and r.reason == "json: data.status is down"
    p = {"json": {"path": "data.id", "op": "exists"}}
    assert (await make(respond(json={"data": {"id": 1}}), p).check("h", 1000)).ok
    r = await make(respond(json={"data": {}}), p).check("h", 1000)
    assert not r.ok and r.reason == "json: data.id is missing"
    r = await make(respond(text="<html>"), p).check("h", 1000)
    assert not r.ok and r.reason.startswith("json:")


async def test_slow_is_ok_but_flagged(make):
    c = make(respond(), {"slow_ms": 2000}, clock=Clock(step=2.35))  # start/end 2.35 s apart
    r = await c.check("h", 10000)
    assert r.ok and r.slow and r.reason == "slow 2350 ms"
    fast = await make(respond(), {"slow_ms": 2000}).check("h", 1000)
    assert fast.ok and not fast.slow


async def test_redirect_followed_and_not(make):
    def handler(request):
        if request.url.path == "/health":
            return httpx2.Response(302, headers={"location": "https://api.example.com/v2"})
        return httpx2.Response(200)

    r = await make(handler).check("h", 1000)
    assert r.ok and r.value["final_url"] == "https://api.example.com/v2"
    r = await make(handler, {"follow_redirects": False, "expect_status": "200"}).check("h", 1000)
    assert not r.ok and r.reason == "status 302"
    assert r.value["final_url"] == URL


async def _auth_header(make, params, secret):
    seen = {}

    def handler(request):
        seen.update(request.headers)
        return httpx2.Response(200)

    await make(handler, params, secret=secret).check("h", 1000)
    return seen


async def test_auth_bearer(make):
    h = await _auth_header(make, {"auth": {"type": "bearer"}}, "tok")
    assert h["authorization"] == "Bearer tok"


async def test_auth_basic(make):
    h = await _auth_header(make, {"auth": {"type": "basic", "username": "bob"}}, "pw")
    assert h["authorization"] == "Basic " + base64.b64encode(b"bob:pw").decode()


async def test_auth_header(make):
    h = await _auth_header(make, {"auth": {"type": "header", "header_name": "X-Api-Key"}}, "k1")
    assert h["x-api-key"] == "k1"


async def test_no_secret_no_auth_header(make):
    h = await _auth_header(make, {"auth": {"type": "bearer"}}, None)
    assert "authorization" not in h


async def test_method_headers_body(make):
    seen = {}

    def handler(request):
        seen.update(method=request.method, body=request.content, hdr=request.headers["x-a"])
        return httpx2.Response(200)

    p = {"method": "POST", "headers": {"X-A": "1"}, "body": "payload"}
    assert (await make(handler, p).check("h", 1000)).ok
    assert seen == {"method": "POST", "body": b"payload", "hdr": "1"}


async def test_timeout(make):
    def handler(request):
        raise httpx2.ReadTimeout("slow", request=request)

    r = await make(handler).check("h", 1000)
    assert not r.ok and r.reason == "timeout"


async def test_connect_error_refused(make):
    def handler(request):
        raise httpx2.ConnectError("All connection attempts failed", request=request)

    r = await make(handler).check("h", 1000)
    assert not r.ok and r.reason == "refused"


async def test_dns_error(make):
    import socket

    def handler(request):
        err = httpx2.ConnectError("lookup failed", request=request)
        err.__cause__ = socket.gaierror(8, "nodename nor servname provided")
        raise err

    r = await make(handler).check("h", 1000)
    assert not r.ok and r.reason == "dns"


async def test_tls_error(make):
    import ssl

    def handler(request):
        err = httpx2.ConnectError("handshake", request=request)
        err.__cause__ = ssl.SSLCertVerificationError("certificate verify failed")
        raise err

    r = await make(handler).check("h", 1000)
    assert not r.ok and r.reason.startswith("tls: ")


class FakeCerts:
    def __init__(self, expires):
        self.expires = expires
        self.calls = []

    async def expiry(self, host, port, timeout_ms):
        self.calls.append((host, port, timeout_ms))
        return self.expires


async def test_cert_reader_fills_value(make):
    expires = datetime.now(UTC) + timedelta(days=12, hours=1)
    certs = FakeCerts(expires)
    r = await make(respond(), cert_reader=certs).check("h", 3000)
    assert r.value["cert_expires"] == expires.isoformat() and r.value["cert_days"] == 12
    assert certs.calls == [("api.example.com", 443, 3000)]


async def test_cert_not_read_for_http(make):
    certs = FakeCerts(datetime.now(UTC))
    c = make(respond(), {"url": "http://plain.example.com/"}, cert_reader=certs)
    r = await c.check("h", 1000)
    assert certs.calls == [] and r.value["cert_days"] is None


async def test_pool_shares_clients_and_closes():
    pool = HttpClientPool(transport=httpx2.MockTransport(respond()))
    a = pool.get(True, True)
    assert pool.get(True, True) is a
    assert pool.get(False, True) is not a
    await pool.aclose()
    assert a.is_closed
