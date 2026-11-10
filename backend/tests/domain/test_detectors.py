import pytest

from app.domain.detectors import ChangeTracker, breaches
from app.domain.models import CheckConfig, CheckResult, CheckType, EventKind, Severity

UPTIME = CheckConfig(1, CheckType.SNMP_UPTIME, {})
IFACES = CheckConfig(2, CheckType.SNMP_IF, {})
CHANGE = CheckConfig(3, CheckType.SNMP_OID, {"oid": "1.3.6.1.4.1.1", "label": "fan", "mode": "change"})
THRESH = CheckConfig(
    4, CheckType.SNMP_OID,
    {"oid": "1.3.6.1.4.1.2", "label": "cpu", "mode": "threshold", "op": ">", "value": 90},
)


def res(check: CheckConfig, label: str, value, ok: bool = True) -> CheckResult:
    return CheckResult(check.type, label, ok, check_id=check.id, value=value)


def ifs(status: str) -> dict:
    return {1: {"name": "Gi1/0/1", "status": status}}


def test_uptime_going_backwards_is_reboot():
    t = ChangeTracker()
    assert t.observe(1, "DC01", UPTIME, res(UPTIME, "snmp uptime", 500000)) == []
    [ev] = t.observe(1, "DC01", UPTIME, res(UPTIME, "snmp uptime", 1200))
    assert ev.kind is EventKind.REBOOT and ev.severity is Severity.CRITICAL
    assert ev.message == "DC01 rebooted" and ev.check_id == 1 and ev.device_id == 1


def test_uptime_increasing_is_quiet():
    t = ChangeTracker()
    t.observe(1, "DC01", UPTIME, res(UPTIME, "snmp uptime", 100))
    assert t.observe(1, "DC01", UPTIME, res(UPTIME, "snmp uptime", 200)) == []


def test_interface_down_then_up():
    t = ChangeTracker()
    assert t.observe(1, "SW1", IFACES, res(IFACES, "interfaces", ifs("up"))) == []
    [down] = t.observe(1, "SW1", IFACES, res(IFACES, "interfaces", ifs("down"), ok=False))
    assert down.kind is EventKind.IF_CHANGE and down.severity is Severity.WARNING
    assert down.message == "SW1 Gi1/0/1 down" and down.check_id == 2
    [up] = t.observe(1, "SW1", IFACES, res(IFACES, "interfaces", ifs("up")))
    assert up.severity is Severity.INFO and up.message == "SW1 Gi1/0/1 up"


def test_interface_other_status_is_warning():
    t = ChangeTracker()
    t.observe(1, "SW1", IFACES, res(IFACES, "interfaces", ifs("up")))
    [ev] = t.observe(1, "SW1", IFACES, res(IFACES, "interfaces", ifs("dormant")))
    assert ev.severity is Severity.WARNING and ev.message == "SW1 Gi1/0/1 dormant"


def test_oid_change_mode_info_event_with_old_and_new():
    t = ChangeTracker()
    assert t.observe(1, "SW1", CHANGE, res(CHANGE, "oid:fan", 1)) == []
    assert t.observe(1, "SW1", CHANGE, res(CHANGE, "oid:fan", 1)) == []
    [ev] = t.observe(1, "SW1", CHANGE, res(CHANGE, "oid:fan", 2))
    assert ev.kind is EventKind.OID_CHANGE and ev.severity is Severity.INFO
    assert ev.message == "SW1 oid:fan changed: 1 → 2"


def test_oid_threshold_breach_and_clear():
    t = ChangeTracker()
    assert t.observe(1, "DC01", THRESH, res(THRESH, "oid:cpu", 50)) == []
    [hi] = t.observe(1, "DC01", THRESH, res(THRESH, "oid:cpu", 95, ok=False))
    assert hi.kind is EventKind.OID_THRESHOLD and hi.severity is Severity.CRITICAL
    assert hi.message == "DC01 oid:cpu > 90 (value 95)"
    assert t.observe(1, "DC01", THRESH, res(THRESH, "oid:cpu", 96, ok=False)) == []
    [lo] = t.observe(1, "DC01", THRESH, res(THRESH, "oid:cpu", 40))
    assert lo.severity is Severity.INFO and lo.message == "DC01 oid:cpu back to normal (value 40)"


def test_threshold_already_breached_on_first_observation():
    t = ChangeTracker()
    [ev] = t.observe(1, "DC01", THRESH, res(THRESH, "oid:cpu", 95.0, ok=False))
    assert ev.message == "DC01 oid:cpu > 90 (value 95)"


def test_failed_result_does_not_update_baseline():
    t = ChangeTracker()
    t.observe(1, "SW1", CHANGE, res(CHANGE, "oid:fan", 1))
    assert t.observe(1, "SW1", CHANGE, res(CHANGE, "oid:fan", None, ok=False)) == []
    assert t.observe(1, "SW1", CHANGE, res(CHANGE, "oid:fan", 1)) == []
    t.observe(1, "DC01", UPTIME, res(UPTIME, "snmp uptime", 500))
    t.observe(1, "DC01", UPTIME, res(UPTIME, "snmp uptime", 10, ok=False))
    assert t.observe(1, "DC01", UPTIME, res(UPTIME, "snmp uptime", 600)) == []


def test_forget_resets_baseline():
    t = ChangeTracker()
    t.observe(1, "DC01", UPTIME, res(UPTIME, "snmp uptime", 500))
    t.forget(1)
    assert t.observe(1, "DC01", UPTIME, res(UPTIME, "snmp uptime", 5)) == []


@pytest.mark.parametrize(
    "op,thr,val,expected",
    [(">", 90, 95, True), (">", 90, 90, False), (">=", 90, 90, True), ("<", 10, 10, False),
     ("<", 10, 5, True), ("<=", 10, 10, True), ("==", 1, 1, True), ("!=", 1, 1, False),
     ("!=", 1, 2, True)],
)
def test_breaches(op, thr, val, expected):
    assert breaches(op, thr, val) is expected
