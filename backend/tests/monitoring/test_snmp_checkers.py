import asyncio

from app.domain.models import CheckType, SnmpSettings
from app.monitoring.checkers.snmp import SnmpIfChecker, SnmpOidChecker, SnmpUptimeChecker
from app.monitoring.snmp_client import SnmpError

S = SnmpSettings("v2c", community="public")
IF_DESCR = "1.3.6.1.2.1.2.2.1.2"
IF_STATUS = "1.3.6.1.2.1.2.2.1.8"


class FakeSnmpClient:
    def __init__(self, gets=None, walks=None, error=None):
        self.gets, self.walks, self.error = gets or {}, walks or {}, error

    async def get(self, host, settings, oids, timeout_ms):
        if self.error:
            raise self.error
        return {o: self.gets[o] for o in oids}

    async def walk(self, host, settings, base_oid, timeout_ms):
        if self.error:
            raise self.error
        return self.walks[base_oid]


def iface_client(statuses):
    return FakeSnmpClient(walks={
        IF_DESCR: {f"{IF_DESCR}.{i}": f"Gi1/0/{i}" for i in statuses},
        IF_STATUS: {f"{IF_STATUS}.{i}": s for i, s in statuses.items()},
    })


async def test_uptime_checker():
    c = FakeSnmpClient(gets={"1.3.6.1.2.1.1.3.0": 12345})
    r = await SnmpUptimeChecker(S, c).check("h", 500)
    assert r.ok and r.type is CheckType.SNMP_UPTIME and r.label == "snmp uptime"
    assert r.value == 12345 and r.latency_ms is not None


async def test_if_checker_maps_status_and_flags_watched_down():
    client = iface_client({1: 1, 2: 2, 3: 5})
    r = await SnmpIfChecker(S, client, None).check("h", 500)
    assert r.ok and r.label == "interfaces"
    assert r.value == {
        1: {"name": "Gi1/0/1", "status": "up"},
        2: {"name": "Gi1/0/2", "status": "down"},
        3: {"name": "Gi1/0/3", "status": "dormant"},
    }
    r = await SnmpIfChecker(S, client, [1, 2]).check("h", 500)
    assert not r.ok and r.reason == "Gi1/0/2 down"
    assert set(r.value) == {1, 2}
    r = await SnmpIfChecker(S, client, [1]).check("h", 500)
    assert r.ok


async def test_oid_checker_threshold_ok_flag():
    oid = "1.3.6.1.4.1.2.0"
    chk = lambda v: SnmpOidChecker(S, FakeSnmpClient(gets={oid: v}), oid, "cpu", "threshold", ">", 90)
    r = await chk(50).check("h", 500)
    assert r.ok and r.label == "oid:cpu" and r.value == 50
    r = await chk(95).check("h", 500)
    assert not r.ok and r.value == 95
    r = await chk("abc").check("h", 500)
    assert not r.ok and r.reason == "not numeric"


async def test_oid_checker_change_mode_ok_when_answering():
    oid = "1.3.6.1.4.1.1.0"
    r = await SnmpOidChecker(S, FakeSnmpClient(gets={oid: "x"}), oid, "fan", "change").check("h", 500)
    assert r.ok and r.value == "x"


async def test_snmp_error_becomes_failed_result():
    c = FakeSnmpClient(error=SnmpError("authError"))
    for chk in (SnmpUptimeChecker(S, c), SnmpIfChecker(S, c, None),
                SnmpOidChecker(S, c, "1.3.6.1.4.1.1.0", "fan", "change")):
        r = await chk.check("h", 500)
        assert not r.ok and r.reason == "snmp: authError" and r.value is None


async def test_timeout_becomes_failed_result():
    c = FakeSnmpClient(error=asyncio.TimeoutError())
    r = await SnmpUptimeChecker(S, c).check("h", 500)
    assert not r.ok and r.reason.startswith("snmp:")
