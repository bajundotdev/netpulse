import base64
import logging
import time
from datetime import UTC, datetime, timedelta

import httpx2
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.infra.db import CheckRow, EventRow
from app.main import create_app
from app.monitoring.checkers.http import HttpClientPool
from app.monitoring.factory import default_factory

SECRET = "tok3n-SUPERSECRET-9f2"
URL = "https://10.0.0.5/health"  # an IP: the monitor's DNS step is a no-op


class Fake:
    """Programmable upstream behind the HttpClientPool, plus a cert reader."""

    def __init__(self) -> None:
        self.mode = "ok"
        self.seen: list[httpx2.Request] = []
        self.cert_expires: datetime | None = None

    def handler(self, request: httpx2.Request) -> httpx2.Response:
        self.seen.append(request)
        if self.mode == "boom":
            raise httpx2.ReadError(f"upstream said {request.headers.get('authorization')}")
        if self.mode == "slow":
            time.sleep(0.05)
        if self.mode == "500":
            return httpx2.Response(500)
        return httpx2.Response(200, json={"ok": True})

    async def expiry(self, host, port, timeout_ms):
        return self.cert_expires


@pytest.fixture
def fake():
    return Fake()


@pytest.fixture
def client(tmp_path, fake):
    pool = HttpClientPool(transport=httpx2.MockTransport(fake.handler))
    factory = default_factory(http_pool=pool, cert_reader=fake)
    app = create_app(Settings(data_dir=tmp_path / "data"), factory=factory, start_monitor=False)
    with TestClient(app, base_url="http://localhost") as c:
        yield c


def web(client, **kw):
    r = client.post("/api/devices", json={"name": "API", "kind": "web", "url": URL, **kw})
    assert r.status_code == 201, r.text
    return r.json()


def add_http(client, device_id, secret=SECRET, auth=None, **params):
    body = {"type": "http", "params": {"url": URL, "auth": auth or {"type": "bearer"}, **params}}
    if secret is not None:
        body["secret"] = secret
    r = client.post(f"/api/devices/{device_id}/checks", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def test_web_device_with_only_url(client):
    d = web(client)
    assert d["host"] == "10.0.0.5" and d["url"] == URL and d["kind"] == "web"
    assert d["liveness"] == "http" and d["interval_s"] == 30 and d["timeout_ms"] == 10000
    assert client.get(f"/api/devices/{d['id']}").json()["url"] == URL


def test_web_device_host_derived_from_hostname(client):
    d = web(client, name="STS", url="https://STS.example.ph:8443/adfs")
    assert d["host"] == "sts.example.ph"


def test_other_kinds_keep_old_defaults(client):
    d = client.post("/api/devices", json={"name": "S", "host": "10.0.0.2", "kind": "server"}).json()
    assert d["interval_s"] == 5 and d["timeout_ms"] == 1000 and d["url"] is None


@pytest.mark.parametrize(
    "body",
    [
        {"name": "W", "kind": "web"},
        {"name": "W", "kind": "web", "url": URL, "liveness": "ping"},
        {"name": "W", "host": "10.0.0.2", "liveness": "http"},
        {"name": "W", "kind": "web", "url": "ftp://x/"},
        {"name": "W", "kind": "web", "url": "https://x/", "interval_s": 5},  # 10 s timeout default
    ],
)
def test_invalid_web_devices_are_422(client, body):
    assert client.post("/api/devices", json=body).status_code == 422


def test_update_web_url_rederives_host_and_enforces_rules(client):
    d = web(client)
    r = client.put(f"/api/devices/{d['id']}", json={"url": "https://other.example/x"})
    assert r.status_code == 200 and r.json()["host"] == "other.example"
    assert client.put(f"/api/devices/{d['id']}", json={"url": None}).status_code == 422
    assert client.put(f"/api/devices/{d['id']}", json={"liveness": "ping"}).status_code == 422
    s = client.post("/api/devices", json={"name": "S", "host": "10.0.0.2"}).json()
    assert client.put(f"/api/devices/{s['id']}", json={"liveness": "http"}).status_code == 422
    ok = client.put(f"/api/devices/{s['id']}", json={"liveness": "http", "url": "http://10.0.0.2/"})
    assert ok.status_code == 200 and ok.json()["liveness"] == "http"
    assert client.put(f"/api/devices/{s['id']}", json={"url": None}).status_code == 422
    assert client.put(f"/api/devices/{s['id']}", json={"kind": "web"}).json()["kind"] == "web"


def test_http_check_with_secret_has_secret_flag(client):
    d = web(client)
    c = add_http(client, d["id"])
    assert c["has_secret"] is True and "secret" not in c and c["params"]["auth"] == {"type": "bearer"}
    plain = client.post(
        f"/api/devices/{d['id']}/checks", json={"type": "http", "params": {"url": URL}}
    ).json()
    assert plain["has_secret"] is False


def test_secret_is_encrypted_at_rest_and_kept_or_cleared_on_update(client):
    d = web(client)
    c = add_http(client, d["id"])
    sf = client.app.state.container.session_factory
    with sf() as s:
        enc = s.get(CheckRow, c["id"]).secret_enc
    assert enc and SECRET not in enc
    body = {"type": "http", "params": {"url": URL, "auth": {"type": "bearer"}, "slow_ms": 500}}
    kept = client.put(f"/api/checks/{c['id']}", json=body).json()  # secret omitted -> kept
    assert kept["has_secret"] is True and kept["params"]["slow_ms"] == 500
    cleared = client.put(f"/api/checks/{c['id']}", json={**body, "secret": ""})
    assert cleared.status_code == 422  # auth without any secret is unusable
    no_auth = client.put(
        f"/api/checks/{c['id']}", json={"type": "http", "params": {"url": URL}, "secret": ""}
    ).json()
    assert no_auth["has_secret"] is False
    with sf() as s:
        assert s.get(CheckRow, c["id"]).secret_enc is None


def test_auth_without_secret_on_create_is_422_and_secret_without_auth_too(client):
    d = web(client)
    r = client.post(
        f"/api/devices/{d['id']}/checks",
        json={"type": "http", "params": {"url": URL, "auth": {"type": "bearer"}}},
    )
    assert r.status_code == 422
    r = client.post(
        f"/api/devices/{d['id']}/checks",
        json={"type": "http", "params": {"url": URL}, "secret": SECRET},
    )
    assert r.status_code == 422 and SECRET not in r.text


def test_changing_check_type_drops_the_secret(client):
    d = web(client)
    c = add_http(client, d["id"])
    out = client.put(f"/api/checks/{c['id']}", json={"type": "tcp", "params": {"port": 443}}).json()
    assert out["has_secret"] is False
    with client.app.state.container.session_factory() as s:
        assert s.get(CheckRow, c["id"]).secret_enc is None


def test_device_create_with_inline_checks_stores_secret(client):
    r = client.post(
        "/api/devices",
        json={
            "name": "API", "kind": "web", "url": URL,
            "checks": [{"type": "http", "params": {"url": URL, "auth": {"type": "bearer"}},
                        "secret": SECRET}],
        },
    )
    assert r.status_code == 201 and r.json()["checks"][0]["has_secret"] is True
    assert SECRET not in r.text


def test_http_secret_never_returned(client, fake, caplog):
    caplog.set_level(logging.DEBUG)
    d = web(client)
    basic = add_http(client, d["id"], auth={"type": "basic", "username": "svc"}, name="basic")
    add_http(client, d["id"], name="bearer")
    texts = [
        client.get("/api/devices").text,
        client.get(f"/api/devices/{d['id']}").text,
        client.get(f"/api/devices/{d['id']}/checks").text,
        client.get("/api/status").text,
    ]
    # 422 bodies: bad check params / bad device with the secret in the body
    for r in (
        client.post(f"/api/devices/{d['id']}/checks",
                    json={"type": "http", "params": {"url": "ftp://x"}, "secret": SECRET}),
        client.put(f"/api/checks/{basic['id']}",
                   json={"type": "http", "params": {"url": URL, "slow_ms": -5,
                                                    "auth": {"type": "bearer"}}, "secret": SECRET}),
        client.post("/api/devices", json={
            "name": "bad", "kind": "web", "url": "nope",
            "checks": [{"type": "http", "params": {"url": URL, "auth": {"type": "bearer"}},
                        "secret": SECRET}]}),
        client.post(f"/api/devices/{d['id']}/checks",
                    json={"type": "http", "params": {"url": URL}, "secret": SECRET}),
    ):
        assert r.status_code == 422
        texts.append(r.text)
    # /test results: success, upstream error echoing the Authorization header, and 500
    for mode in ("ok", "boom", "500"):
        fake.mode = mode
        r = client.post(f"/api/devices/{d['id']}/test")
        assert r.status_code == 200
        texts.append(r.text)
    assert any(r["reason"] for r in client.post(f"/api/devices/{d['id']}/test").json())
    b64 = base64.b64encode(f"svc:{SECRET}".encode()).decode()
    for text in texts:
        assert SECRET not in text and b64 not in text
    assert SECRET not in caplog.text and b64 not in caplog.text
    # the secret really was sent (the test above is not vacuous)
    assert any(req.headers.get("authorization") == f"Bearer {SECRET}" for req in fake.seen)
    assert any(req.headers.get("authorization") == f"Basic {b64}" for req in fake.seen)


def test_secret_never_in_event_log_or_logs_for_failing_check(client, fake, caplog):
    caplog.set_level(logging.DEBUG)
    d = client.put(
        f"/api/devices/{web(client)['id']}", json={"fail_threshold": 1}
    ).json()
    add_http(client, d["id"], name="api")
    fake.mode = "boom"
    c = client.app.state.container

    async def cycle():
        [cfg] = await c.devices.configs()
        return await c.monitor.run_cycle(cfg)

    client.portal.call(cycle)
    # let the DB writer thread flush
    events = client.get("/api/events").json()
    assert events, "expected a status event"
    with c.session_factory() as s:
        rows = [(e.message, e.kind) for e in s.query(EventRow).all()]
    blob = repr(events) + repr(rows) + caplog.text
    assert SECRET not in blob
    assert any("API" in m for m, _ in rows)


def test_cert_event_for_http_check_via_monitor(client, fake):
    d = web(client)
    add_http(client, d["id"], name="api", cert_warn_days=14)
    fake.cert_expires = datetime.now(UTC) + timedelta(days=5, hours=1)
    c = client.app.state.container

    async def cycle():
        [cfg] = await c.devices.configs()
        await c.monitor.run_cycle(cfg)
        await c.monitor.run_cycle(cfg)

    client.portal.call(cycle)
    msgs = [e["message"] for e in client.get("/api/events").json() if e["kind"] == "cert_expiry"]
    assert msgs == ["API cert for 10.0.0.5 expires in 5 days"]


def test_failed_device_create_leaves_no_half_created_device(client):
    body = {
        "name": "API", "kind": "web", "url": URL,
        "checks": [{"type": "http", "params": {"url": URL, "auth": {"type": "bearer"}}}],
    }
    r = client.post("/api/devices", json=body)
    assert r.status_code == 422
    assert client.get("/api/devices").json() == []
    body["checks"][0]["secret"] = SECRET
    assert client.post("/api/devices", json=body).status_code == 201


def test_test_endpoint_flags_a_slow_http_result(client, fake):
    d = web(client)
    add_http(client, d["id"], slow_ms=1)
    fake.mode = "slow"
    results = client.post(f"/api/devices/{d['id']}/test").json()
    http = [r for r in results if r["check_id"] is not None]
    assert http and http[0]["ok"] is True and http[0]["slow"] is True
    fake.mode = "ok"
    fast = client.post(f"/api/devices/{d['id']}/test").json()
    assert all(r["slow"] is False for r in fast)


# --- secret validation at save -------------------------------------------------

BAD_TOKENS = ["tok\nen-SECRETVALUE", "tok\x00en-SECRETVALUE", "tok en-SECRETVALUE", "tök-SECRETVALUE"]


@pytest.mark.parametrize("secret", BAD_TOKENS)
def test_bearer_token_that_cannot_be_a_header_is_422_without_echo(client, secret):
    d = web(client)
    r = client.post(f"/api/devices/{d['id']}/checks", json={
        "type": "http", "params": {"url": URL, "auth": {"type": "bearer"}}, "secret": secret})
    assert r.status_code == 422
    assert "Token contains characters that cannot be sent in an HTTP header" in r.text
    assert "SECRETVALUE" not in r.text
    inline = client.post("/api/devices", json={
        "name": "inline", "kind": "web", "url": URL,
        "checks": [{"type": "http", "params": {"url": URL, "auth": {"type": "bearer"}},
                    "secret": secret}]})
    assert inline.status_code == 422 and "SECRETVALUE" not in inline.text


@pytest.mark.parametrize("secret", ["va\nlue-SECRETVALUE", "va\x01lue-SECRETVALUE", "välue-SECRETVALUE"])
def test_header_value_that_cannot_be_sent_is_422_without_echo(client, secret):
    d = web(client)
    c = add_http(client, d["id"], auth={"type": "header", "header_name": "X-Key"})
    r = client.put(f"/api/checks/{c['id']}", json={
        "type": "http", "params": {"url": URL, "auth": {"type": "header", "header_name": "X-Key"}},
        "secret": secret})
    assert r.status_code == 422
    assert "Header value contains characters that cannot be sent in an HTTP header" in r.text
    assert "SECRETVALUE" not in r.text


def test_secret_and_auth_names_are_trimmed_and_sent_trimmed(client, fake):
    d = web(client)
    add_http(client, d["id"], secret=f"  {SECRET} \n", name="bearer")
    add_http(client, d["id"], secret=" key with inner spaces ",
             auth={"type": "header", "header_name": " X-Key "}, name="header")
    basic = add_http(client, d["id"], secret=" pä ss ",
                     auth={"type": "basic", "username": " svc "}, name="basic")
    assert basic["params"]["auth"] == {"type": "basic", "username": "svc"}
    assert client.post(f"/api/devices/{d['id']}/test").status_code == 200
    sent = [(req.headers.get("authorization"), req.headers.get("x-key")) for req in fake.seen]
    assert (f"Bearer {SECRET}", None) in sent
    assert (None, "key with inner spaces") in sent
    b64 = base64.b64encode("svc:pä ss".encode()).decode()
    assert (f"Basic {b64}", None) in sent


def test_whitespace_only_secret_is_no_secret(client):
    d = web(client)
    r = client.post(f"/api/devices/{d['id']}/checks", json={
        "type": "http", "params": {"url": URL, "auth": {"type": "bearer"}}, "secret": "  \t "})
    assert r.status_code == 422  # auth needs a secret
