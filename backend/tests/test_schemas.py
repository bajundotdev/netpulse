import pytest
from pydantic import ValidationError

from app.schemas import CheckIn, DeviceIn, DeviceUpdate, SnmpIn


@pytest.mark.parametrize("host", ["10.0.0.1", "dc01", "dc01.ad.dostcaraga.ph", "fe80::1"])
def test_device_in_accepts_valid_hosts(host):
    assert DeviceIn(name="x", host=host).host == host


@pytest.mark.parametrize("host", ["", "dc 01", "http://dc01", "-dc01", "dc01-", "a" * 254])
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
