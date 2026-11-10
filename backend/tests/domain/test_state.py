from datetime import UTC, datetime, timedelta

from app.domain.models import CheckResult, CheckType, DeviceStatus, EventKind, Severity
from app.domain.state import DeviceState, next_state, paused_state

T0 = datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC)
T1 = T0 + timedelta(seconds=5)
T2 = T0 + timedelta(seconds=10)


def ok(label: str = "ping") -> CheckResult:
    return CheckResult(type=CheckType.PING, label=label, ok=True)


def fail(reason: str, label: str = "ping") -> CheckResult:
    return CheckResult(type=CheckType.PING, label=label, ok=False, reason=reason)


def test_first_success_goes_up_with_info_event():
    s, ev = next_state(DeviceState.initial(T0), "DC01", 1, ok("ping"), [], 2, T1)
    assert s.status is DeviceStatus.UP and s.since == T1 and s.consecutive_failures == 0
    assert ev.kind is EventKind.STATUS_CHANGE and ev.severity is Severity.INFO
    assert ev.status == "UP" and ev.previous_status == "UNKNOWN" and ev.message == "DC01 UP"


def test_single_failure_below_threshold_keeps_up_and_no_event():
    up = DeviceState(DeviceStatus.UP, 0, T0)
    s, ev = next_state(up, "DC01", 1, fail("timeout"), [], 2, T1)
    assert s.status is DeviceStatus.UP and s.consecutive_failures == 1 and s.since == T0 and ev is None


def test_threshold_failures_go_down_critical_with_reason():
    s1, _ = next_state(DeviceState(DeviceStatus.UP, 0, T0), "DC01", 1, fail("timeout"), [], 2, T1)
    s2, ev = next_state(s1, "DC01", 1, fail("timeout"), [], 2, T2)
    assert s2.status is DeviceStatus.DOWN and ev.severity is Severity.CRITICAL
    assert ev.message == "DC01 DOWN (ping: timeout)"


def test_liveness_ok_but_port_failing_is_degraded_naming_checks():
    s, ev = next_state(DeviceState(DeviceStatus.UP, 0, T0), "DC01", 1, ok("ping"),
                       [ok("tcp/53"), fail("refused", label="tcp/389")], 2, T1)
    assert s.status is DeviceStatus.DEGRADED and ev.severity is Severity.WARNING
    assert ev.message == "DC01 DEGRADED: tcp/389 refused"


def test_recovery_from_down_is_info_with_previous_status():
    s, ev = next_state(DeviceState(DeviceStatus.DOWN, 3, T0), "DC01", 1, ok("ping"), [], 2, T1)
    assert s.status is DeviceStatus.UP and ev.previous_status == "DOWN" and ev.message == "DC01 UP"


def test_same_status_twice_emits_no_event():
    s, ev = next_state(DeviceState(DeviceStatus.UP, 0, T0), "DC01", 1, ok("ping"), [], 2, T1)
    assert ev is None and s.since == T0


def test_unknown_stays_unknown_below_threshold():
    s, ev = next_state(DeviceState.initial(T0), "DC01", 1, fail("timeout"), [], 2, T1)
    assert s.status is DeviceStatus.UNKNOWN and ev is None


def test_paused_state_emits_info_once():
    s, ev = paused_state(DeviceState(DeviceStatus.UP, 0, T0), "DC01", 1, T1)
    assert s.status is DeviceStatus.PAUSED and ev.message == "DC01 PAUSED"
    assert paused_state(s, "DC01", 1, T2)[1] is None


def test_degraded_message_falls_back_when_reason_missing():
    up = DeviceState(DeviceStatus.UP, 0, T0)
    other = CheckResult(type=CheckType.SNMP_OID, label="oid:cpu", ok=False)
    s, ev = next_state(up, "DC01", 1, ok(), [other], 2, T1)
    assert s.status is DeviceStatus.DEGRADED and ev.message == "DC01 DEGRADED: oid:cpu failed"
