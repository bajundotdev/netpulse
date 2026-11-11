import time
from types import SimpleNamespace
from datetime import UTC, datetime, timedelta

import pytest

from app.services.history import HistoryService

KEYS = {"range", "start", "end", "bucket_seconds", "problems_last_hour", "overall", "devices"}


def make(client, name="SW1", host="10.0.0.2"):
    r = client.post("/api/devices", json={"name": name, "host": host, "kind": "switch"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_history_default_range_and_shape(client):
    device_id = make(client)
    body = client.get("/api/history").json()
    assert set(body) == KEYS
    assert body["range"] == "24h" and body["bucket_seconds"] == 900
    assert len(body["overall"]["problems"]) == len(body["overall"]["status"]) == 96
    assert [d["device_id"] for d in body["devices"]] == [device_id]
    assert len(body["devices"][0]["buckets"]) == 96
    start = datetime.fromisoformat(body["start"])
    end = datetime.fromisoformat(body["end"])
    assert body["start"].endswith("+00:00") and body["end"].endswith("+00:00")
    assert end - start == timedelta(days=1)
    assert end.timestamp() % 900 == 0
    assert end >= datetime.now(UTC)


@pytest.mark.parametrize("r,n", [("1h", 60), ("24h", 96), ("7d", 84)])
def test_history_slot_counts(client, r, n):
    make(client)
    body = client.get("/api/history", params={"range": r}).json()
    assert body["range"] == r
    assert len(body["overall"]["status"]) == n
    assert len(body["devices"][0]["buckets"]) == n


def test_history_without_devices_has_empty_slots(client):
    body = client.get("/api/history").json()
    assert body["devices"] == []
    assert body["overall"]["problems"] == [0] * 96
    assert body["overall"]["status"] == [None] * 96
    assert body["problems_last_hour"] == 0


def test_history_bad_range_is_422(client):
    assert client.get("/api/history", params={"range": "30d"}).status_code == 422


def test_history_reports_down_slots_and_problem_count(client):
    device_id = make(client)
    repo = client.app.state.container.history
    now = datetime.now(UTC)
    repo.add(device_id, "UP", now - timedelta(minutes=30))
    repo.add(device_id, "DOWN", now - timedelta(minutes=20))
    repo.add(device_id, "UP", now - timedelta(minutes=15))

    body = client.get("/api/history", params={"range": "1h"}).json()
    buckets = body["devices"][0]["buckets"]
    assert "DOWN" in buckets
    index = buckets.index("DOWN")
    assert body["overall"]["status"][index] == "DOWN"
    assert body["overall"]["problems"][index] == 1
    assert body["problems_last_hour"] == 1
    assert 0 < body["devices"][0]["uptime_pct"] < 100


def test_history_only_lists_current_devices(client):
    keep = make(client, "A", "10.0.0.1")
    gone = make(client, "B", "10.0.0.2")
    repo = client.app.state.container.history
    repo.add(gone, "DOWN", datetime.now(UTC) - timedelta(minutes=5))
    assert client.delete(f"/api/devices/{gone}").status_code == 204
    body = client.get("/api/history").json()
    assert [d["device_id"] for d in body["devices"]] == [keep]
    assert body["problems_last_hour"] == 0


async def test_service_uses_injected_clock_and_orders_by_device_id(client):
    c = client.app.state.container
    ids = [make(client, "A", "10.0.0.1"), make(client, "B", "10.0.0.2")]
    now = datetime(2026, 11, 11, 5, 7, 30, tzinfo=UTC)
    c.history.add(ids[1], "DOWN", now - timedelta(minutes=2))
    devices = SimpleNamespace(list=lambda: [SimpleNamespace(id=i) for i in ids])
    service = HistoryService(c.history, devices, c.db, clock=lambda: now)
    body = await service.get("1h")
    assert body["end"] == datetime(2026, 11, 11, 5, 8, tzinfo=UTC)
    assert body["start"] == datetime(2026, 11, 11, 4, 8, tzinfo=UTC)
    assert [d["device_id"] for d in body["devices"]] == ids
    assert body["devices"][1]["buckets"][-4:] == [None, "DOWN", "DOWN", "DOWN"]
    assert body["problems_last_hour"] == 1


def test_history_7d_with_20_devices_is_fast(client):
    c = client.app.state.container
    ids = [make(client, f"D{i}", f"10.0.1.{i + 1}") for i in range(20)]
    now = datetime.now(UTC)
    # 30 days, one change every 30 minutes per device: 1440 rows x 20 devices.
    for n in range(30 * 48):
        ts = now - timedelta(minutes=30 * (30 * 48 - n))
        c.history.add_many(ids, "UP" if n % 2 == 0 else "DOWN", ts)
    started = time.perf_counter()
    r = client.get("/api/history", params={"range": "7d"})
    elapsed = time.perf_counter() - started
    assert r.status_code == 200
    assert len(r.json()["devices"]) == 20
    assert elapsed < 0.2, elapsed


def test_startup_survives_a_failing_prune(settings, monkeypatch):
    from fastapi.testclient import TestClient

    from app.infra.repositories import StatusHistoryRepository
    from app.main import create_app
    from tests.api.conftest import fake_factory

    def boom(self, cutoff):
        raise RuntimeError("transient")

    monkeypatch.setattr(StatusHistoryRepository, "prune", boom)
    app = create_app(settings, factory=fake_factory(), start_monitor=False)
    with TestClient(app, base_url="http://localhost") as c:
        assert c.get("/api/health").status_code == 200
