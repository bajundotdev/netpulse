from datetime import datetime

import pytest

from app.config import REPO_ROOT, Settings
from app.domain.models import CheckType, DomainEvent, EventKind, Severity
from app.infra.repositories import (
    CheckRepository,
    DeviceRepository,
    DuplicateNameError,
    EventRepository,
    NotFoundError,
)


@pytest.fixture
def devices(session_factory, secret_box):
    return DeviceRepository(session_factory, secret_box)


@pytest.fixture
def checks(session_factory):
    return CheckRepository(session_factory)


@pytest.fixture
def events(session_factory):
    return EventRepository(session_factory)


def test_settings_defaults_and_env(monkeypatch, tmp_path):
    for k in ("NETPULSE_HOST", "NETPULSE_PORT", "NETPULSE_DATA_DIR"):
        monkeypatch.delenv(k, raising=False)
    s = Settings.from_env()
    assert (s.host, s.port, s.data_dir) == ("127.0.0.1", 8765, REPO_ROOT / "data")
    assert s.db_path == s.data_dir / "netpulse.db" and s.key_path == s.data_dir / "secret.key"
    monkeypatch.setenv("NETPULSE_PORT", "9000")
    monkeypatch.setenv("NETPULSE_DATA_DIR", str(tmp_path))
    s = Settings.from_env()
    assert s.port == 9000 and s.data_dir == tmp_path


def test_create_device_encrypts_community(devices):
    row = devices.create(
        {"name": "SW1", "host": "10.0.0.2", "snmp_version": "v2c", "snmp_community": "public"}
    )
    assert row.snmp_community_enc != "public"
    assert devices.to_config(row).snmp.community == "public"


def test_update_secret_none_keeps_empty_clears(devices):
    d = devices.create(
        {"name": "SW1", "host": "10.0.0.2", "snmp_version": "v2c", "snmp_community": "public"}
    )
    kept = devices.update(d.id, {"snmp_community": None, "notes": "x"})
    assert devices.to_config(kept).snmp.community == "public" and kept.notes == "x"
    cleared = devices.update(d.id, {"snmp_community": ""})
    assert cleared.snmp_community_enc is None
    assert devices.to_config(cleared).snmp.community is None
    changed = devices.update(d.id, {"snmp_community": "private"})
    assert devices.to_config(changed).snmp.community == "private"


def test_to_config_snmp_none_without_version(devices):
    d = devices.create({"name": "DC01", "host": "10.0.0.1"})
    assert devices.to_config(d).snmp is None


def test_duplicate_name_raises(devices):
    devices.create({"name": "DC01", "host": "10.0.0.1"})
    with pytest.raises(DuplicateNameError):
        devices.create({"name": "DC01", "host": "10.0.0.9"})


def test_get_missing_raises(devices):
    with pytest.raises(NotFoundError):
        devices.get(99)


def test_delete_device_cascades_checks(devices, checks):
    d = devices.create({"name": "DC01", "host": "10.0.0.1"})
    c = checks.create(d.id, {"type": "tcp", "params": {"port": 389}})
    devices.delete(d.id)
    assert checks.list_for_device(d.id) == []
    with pytest.raises(NotFoundError):
        checks.get(c.id)


def test_delete_device_keeps_events(devices, events):
    d = devices.create({"name": "DC01", "host": "10.0.0.1"})
    events.add(DomainEvent(d.id, Severity.CRITICAL, EventKind.STATUS_CHANGE, "DC01 DOWN (ping: timeout)"))
    devices.delete(d.id)
    [e] = events.list()
    assert e["device_id"] is None and e["message"].startswith("DC01")


def test_check_update_and_delete(devices, checks):
    d = devices.create({"name": "DC01", "host": "10.0.0.1"})
    c = checks.create(d.id, {"type": "tcp", "params": {"port": 389}})
    u = checks.update(c.id, {"params": {"port": 636}, "enabled": False})
    assert u.params == {"port": 636} and u.enabled is False
    checks.delete(c.id)
    assert checks.list_for_device(d.id) == []


def test_to_config_builds_checks_tuple(devices, checks):
    d = devices.create({"name": "DC01", "host": "10.0.0.1"})
    checks.create(d.id, {"type": "tcp", "params": {"port": 389}})
    cfg = devices.to_config(devices.get(d.id))
    assert cfg.checks[0].type is CheckType.TCP and cfg.checks[0].params == {"port": 389}


def test_event_dict_shape_and_utc_iso(events):
    ev = events.add(
        DomainEvent(None, Severity.INFO, EventKind.STATUS_CHANGE, "up", status="UP", previous_status="DOWN")
    )
    assert ev["ts"].endswith("+00:00")
    assert datetime.fromisoformat(ev["ts"]).utcoffset().total_seconds() == 0
    assert (ev["status"], ev["previous_status"], ev["acknowledged"]) == ("UP", "DOWN", False)
    assert events.list()[0]["ts"] == ev["ts"]


def test_events_newest_first_filters_and_paging(devices, events):
    d = devices.create({"name": "DC01", "host": "10.0.0.1"})
    for i in range(5):
        sev = Severity.CRITICAL if i % 2 else Severity.INFO
        events.add(DomainEvent(d.id, sev, EventKind.CHECK_ERROR, f"m{i}"))
    events.add(DomainEvent(None, Severity.INFO, EventKind.CHECK_ERROR, "other"))
    allv = events.list()
    assert [e["message"] for e in allv] == ["other", "m4", "m3", "m2", "m1", "m0"]
    assert [e["message"] for e in events.list(device_id=d.id, severity="critical")] == ["m3", "m1"]
    page = events.list(limit=2, before_id=allv[1]["id"])
    assert [e["message"] for e in page] == ["m3", "m2"]


def test_ack_and_clear(events):
    e = events.add(DomainEvent(None, Severity.INFO, EventKind.CHECK_ERROR, "x"))
    events.ack(e["id"])
    assert events.list()[0]["acknowledged"] is True
    assert events.clear() == 1 and events.list() == []


def test_event_ids_are_not_reused_after_clear(events):
    first = events.add(DomainEvent(None, Severity.INFO, EventKind.CHECK_ERROR, "a"))
    events.clear()
    second = events.add(DomainEvent(None, Severity.INFO, EventKind.CHECK_ERROR, "b"))
    assert second["id"] > first["id"]


def test_check_ids_are_not_reused_after_delete(devices, checks):
    d = devices.create({"name": "x", "host": "10.0.0.1"})
    first = checks.create(d.id, {"type": "tcp", "params": {"port": 80}})
    checks.delete(first.id)
    second = checks.create(d.id, {"type": "tcp", "params": {"port": 80}})
    assert second.id > first.id
