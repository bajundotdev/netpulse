import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.domain.models import CheckResult, CheckType
from app.main import create_app
from app.monitoring.factory import CheckerFactory


class FakeChecker:
    def __init__(self, type: CheckType, label: str):
        self.type, self.label = type, label

    async def check(self, host, timeout_ms):
        return CheckResult(self.type, self.label, True, latency_ms=1.5)


def fake_factory() -> CheckerFactory:
    factory = CheckerFactory()
    factory.register(CheckType.PING, lambda c, d: FakeChecker(CheckType.PING, "ping"))
    factory.register(CheckType.TCP, lambda c, d: FakeChecker(CheckType.TCP, f"tcp/{c.params['port']}"))
    return factory


@pytest.fixture
def settings(tmp_path):
    return Settings(data_dir=tmp_path / "data")


@pytest.fixture
def client(settings):
    app = create_app(settings, factory=fake_factory(), start_monitor=False)
    with TestClient(app) as c:
        yield c
