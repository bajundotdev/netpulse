from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.infra.db import make_session_factory
from app.infra.dbexec import DbRunner
from app.infra.repositories import DeviceRepository, StatusHistoryRepository
from app.main import create_app
from app.services.history import HistoryWriter
from tests.api.conftest import fake_factory, settings  # noqa: F401  (fixture)

T = datetime(2026, 11, 11, 12, 0, tzinfo=UTC)
WIDE = (T - timedelta(days=1), T + timedelta(days=1))


@pytest.fixture
def repo(session_factory, secret_box):
    devices = DeviceRepository(session_factory, secret_box)
    devices.create({"name": "A", "host": "10.0.0.1"})
    devices.create({"name": "B", "host": "10.0.0.2"})
    return StatusHistoryRepository(session_factory)


async def test_writer_appends_status_messages(repo):
    run = DbRunner()
    try:
        writer = HistoryWriter(repo, run)
        await writer.handle(
            {
                "device_id": 1,
                "status": "DOWN",
                "previous_status": "UP",
                "since": T.isoformat(),
                "consecutive_failures": 2,
            }
        )
    finally:
        run.shutdown()
    assert repo.window_rows(*WIDE) == {1: [(T, "DOWN")]}


async def test_writer_stopped_rows_for_all_devices(repo):
    run = DbRunner()
    try:
        writer = HistoryWriter(repo, run)
        await writer.stopped([1, 2], T)
    finally:
        run.shutdown()
    assert repo.window_rows(*WIDE) == {1: [(T, "STOPPED")], 2: [(T, "STOPPED")]}


def test_shutdown_writes_stopped(settings):
    app = create_app(settings, factory=fake_factory(), start_monitor=False)
    with TestClient(app, base_url="http://localhost") as client:
        for name, host in (("A", "10.0.0.1"), ("B", "10.0.0.2")):
            assert client.post("/api/devices", json={"name": name, "host": host}).status_code == 201
    factory = make_session_factory(settings.db_path)
    try:
        rows = StatusHistoryRepository(factory).window_rows(*WIDE_NOW())
    finally:
        factory.kw["bind"].dispose()
    assert {d: r[-1][1] for d, r in rows.items()} == {1: "STOPPED", 2: "STOPPED"}


def WIDE_NOW():
    now = datetime.now(UTC)
    return now - timedelta(days=1), now + timedelta(days=1)
