import pytest
from pydantic import ValidationError

from app.schemas import CheckIn, DeviceIn, DeviceUpdate, SnmpIn


@pytest.mark.parametrize("host", ["10.0.0.1", "dc01", "dc01.ad.dostcaraga.ph", "fe80::1"])
def test_device_in_accepts_valid_hosts(host):
    assert DeviceIn(name="x", host=host).host == host


@pytest.mark.parametrize(
    "host",
    ["", "dc 01", "http://dc01", "-dc01", "dc01-", "a" * 254,
     "192.168.1", "10.1", "10.0.0.256", "dc01.123"],
)
def test_device_in_rejects_bad_hosts(host):
    with pytest.raises(ValidationError):
        DeviceIn(name="x", host=host)


def test_defaults():
    d = DeviceIn(name="x", host="10.0.0.1")
    assert (d.interval_s, d.fail_threshold, d.timeout_ms, d.liveness) == (5, 2, 1000, "ping")
    assert d.checks == [] and d.snmp is None


@pytest.mark.parametrize(
    "kw",
    [
        {"interval_s": 1},
        {"interval_s": 3601},
        {"fail_threshold": 0},
        {"fail_threshold": 11},
        {"timeout_ms": 199},
        {"timeout_ms": 10001, "interval_s": 3600},
        {"liveness_port": 0},
        {"liveness_port": 65536},
    ],
)
def test_limits_rejected(kw):
    with pytest.raises(ValidationError):
        DeviceIn(name="x", host="10.0.0.1", **kw)


def test_timeout_must_be_below_interval():
    with pytest.raises(ValidationError):
        DeviceIn(name="x", host="10.0.0.1", interval_s=2, timeout_ms=2000)
    DeviceIn(name="x", host="10.0.0.1", interval_s=2, timeout_ms=1999)


def test_tcp_liveness_requires_port():
    with pytest.raises(ValidationError):
        DeviceIn(name="x", host="10.0.0.1", liveness="tcp")
    assert DeviceIn(name="x", host="10.0.0.1", liveness="tcp", liveness_port=443)


def test_tcp_check_needs_valid_port():
    assert CheckIn(type="tcp", params={"port": 389}).params == {"port": 389}
    for params in ({}, {"port": 0}, {"port": "389"}, {"port": True}):
        with pytest.raises(ValidationError):
            CheckIn(type="tcp", params=params)


def test_oid_check_validation():
    ok = CheckIn(type="snmp_oid", params={"oid": ".1.3.6.1.2.1.1.3.0"})
    assert ok.params["mode"] == "change" and ok.params["label"] == ".1.3.6.1.2.1.1.3.0"
    for params in (
        {"oid": "sysUpTime"},
        {"oid": "1"},
        {},
        {"oid": "1.3.6", "mode": "threshold"},
        {"oid": "1.3.6", "mode": "threshold", "op": ">"},
        {"oid": "1.3.6", "mode": "threshold", "value": 5},
        {"oid": "1.3.6", "mode": "threshold", "op": "~", "value": 5},
        {"oid": "1.3.6", "mode": "bogus"},
    ):
        with pytest.raises(ValidationError):
            CheckIn(type="snmp_oid", params=params)
    t = CheckIn(type="snmp_oid", params={"oid": "1.3.6.1", "mode": "threshold", "op": ">=", "value": 80})
    assert t.params["op"] == ">=" and t.params["value"] == 80


def test_snmp_if_indexes_validation():
    assert CheckIn(type="snmp_if").params == {}
    assert CheckIn(type="snmp_if", params={"if_indexes": [1, 2]}).params == {"if_indexes": [1, 2]}
    with pytest.raises(ValidationError):
        CheckIn(type="snmp_if", params={"if_indexes": ["a"]})


def test_v3_requires_user_and_auth_key_min_8():
    with pytest.raises(ValidationError):
        SnmpIn(version="v3")
    with pytest.raises(ValidationError):
        SnmpIn(version="v3", user="u", auth_proto="SHA", auth_key="short")
    with pytest.raises(ValidationError):
        SnmpIn(version="v3", user="u", priv_proto="AES128", auth_proto="none")
    assert SnmpIn(version="v3", user="u", auth_proto="SHA", auth_key="longenough")
    # creating a device with auth_proto but no key is rejected
    with pytest.raises(ValidationError):
        DeviceIn(name="x", host="10.0.0.1", snmp=SnmpIn(version="v3", user="u", auth_proto="SHA"))


def test_v2c_device_requires_community_on_create_only():
    with pytest.raises(ValidationError):
        DeviceIn(name="x", host="10.0.0.1", snmp={"version": "v2c"})
    assert SnmpIn(version="v2c").community is None  # update may keep the stored one


def test_snmp_checks_require_snmp_in_device_in():
    with pytest.raises(ValidationError):
        DeviceIn(name="x", host="10.0.0.1", checks=[{"type": "snmp_uptime"}])


def test_update_tracks_explicit_null():
    assert "snmp" not in DeviceUpdate().model_fields_set
    assert "snmp" in DeviceUpdate(snmp=None).model_fields_set


# --- http check params --------------------------------------------------------

import pytest as _pytest  # noqa: E402
from pydantic import ValidationError as _VE  # noqa: E402

from app.schemas import CheckIn as _CheckIn  # noqa: E402
from app.schemas import DeviceIn as _DeviceIn  # noqa: E402
from app.schemas import DeviceUpdate as _DeviceUpdate  # noqa: E402


def _http(**params):
    return _CheckIn(type="http", params={"url": "https://a.example/x", **params})


def test_http_params_defaults_and_normalisation():
    c = _http(method="post", expect_status="200, 204,301-302", name="  Login ")
    assert c.params["method"] == "POST" and c.params["name"] == "Login"
    assert c.params["url"] == "https://a.example/x" and c.secret is None


@_pytest.mark.parametrize(
    "bad",
    [
        {"url": "ftp://a.example/"},
        {"url": "a.example/x"},
        {"url": "https://user:pw@a.example/"},
        {"url": "https://"},
        {"method": "TRACE"},
        {"expect_status": "2xx"},
        {"expect_status": "300-200"},
        {"expect_status": "99"},
        {"expect_status": ""},
        {"slow_ms": -1},
        {"slow_ms": 0},
        {"cert_warn_days": -1},
        {"json": {"path": "a", "op": "~=", "value": 1}},
        {"json": {"op": "==", "value": 1}},
        {"json": {"path": "", "op": "exists"}},
        {"keyword": {"text": "", "mode": "contains"}},
        {"keyword": {"text": "ok", "mode": "regex"}},
        {"auth": {"type": "oauth"}},
        {"auth": {"type": "header"}},
        {"headers": {"X-A": "a\nb"}},
        {"verify_tls": "maybe"},
    ],
)
def test_http_params_rejected(bad):
    base = {"url": "https://a.example/x"}
    with _pytest.raises(_VE) as exc:
        _CheckIn(type="http", params={**base, **bad})
    # the messages themselves carry no raw input (pydantic's `input` is stripped by the API)
    assert all("input_value" not in e["msg"] for e in exc.value.errors())


def test_http_url_required():
    with _pytest.raises(_VE):
        _CheckIn(type="http", params={})


def test_http_secret_rules():
    ok = _CheckIn(type="http", params={"url": "https://a/", "auth": {"type": "bearer"}}, secret="t")
    assert ok.secret == "t"
    _CheckIn(type="http", params={"url": "https://a/"}, secret="")  # clearing is always fine
    with _pytest.raises(_VE) as exc:
        _CheckIn(type="http", params={"url": "https://a/"}, secret="tok3n")
    assert all("tok3n" not in e["msg"] for e in exc.value.errors())
    with _pytest.raises(_VE):
        _CheckIn(type="tcp", params={"port": 80}, secret="tok3n")


def test_web_device_rules():
    d = _DeviceIn(name="W", kind="web", url="https://Sts.Example.PH:8443/adfs")
    assert d.host == "sts.example.ph" and d.liveness == "http"
    assert (d.interval_s, d.timeout_ms) == (30, 10000)
    assert _DeviceIn(name="S", host="10.0.0.1").interval_s == 5
    assert _DeviceIn(name="S", host="10.0.0.1").timeout_ms == 1000
    assert _DeviceIn(name="W", kind="web", url="https://a.example/", interval_s=60,
                     timeout_ms=3000).timeout_ms == 3000
    with _pytest.raises(_VE):
        _DeviceIn(name="W", kind="web")
    with _pytest.raises(_VE):
        _DeviceIn(name="W", kind="web", url="https://a.example/", liveness="ping")
    with _pytest.raises(_VE):
        _DeviceIn(name="S", host="10.0.0.1", liveness="http")  # no url
    with _pytest.raises(_VE):
        _DeviceIn(name="S", kind="server")  # host required unless web
    ok = _DeviceIn(name="S", host="10.0.0.1", liveness="http", url="http://10.0.0.1/health")
    assert ok.liveness == "http"


def test_device_update_accepts_url_and_http_liveness():
    u = _DeviceUpdate(url="https://a.example/", liveness="http", kind="web")
    assert u.url == "https://a.example/"
    with _pytest.raises(_VE):
        _DeviceUpdate(url="gopher://a")
