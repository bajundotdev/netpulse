from datetime import UTC, datetime

from app.domain.models import CheckResult, CheckType, DeviceStatus
from app.domain.state import DeviceState
from app.monitoring.status_store import StatusStore


def test_unknown_device_has_no_data():
    store = StatusStore()
    assert store.state(1) is None
    assert store.results(1) == []
    assert store.latency(1) == []


def test_state_and_results_roundtrip():
    store = StatusStore()
    st = DeviceState(DeviceStatus.UP, 0, datetime.now(UTC))
    store.set_state(1, st)
    res = [CheckResult(CheckType.PING, "ping", True, latency_ms=3.0)]
    store.set_results(1, res)
    assert store.state(1) == st
    assert store.results(1) == res


def test_latency_ring_buffer_keeps_last_60():
    store = StatusStore()
    for i in range(70):
        store.add_latency(1, float(i))
    store.add_latency(1, None)
    lat = store.latency(1)
    assert len(lat) == 60
    assert lat[-1] is None
    assert lat[-2] == 69.0


def test_remove_clears_everything():
    store = StatusStore()
    store.set_state(1, DeviceState.initial(datetime.now(UTC)))
    store.set_results(1, [])
    store.add_latency(1, 1.0)
    store.remove(1)
    assert store.state(1) is None
    assert store.latency(1) == []
    store.remove(1)  # idempotent
