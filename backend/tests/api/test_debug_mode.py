import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

from .conftest import fake_factory


def _client(settings: Settings) -> TestClient:
    return TestClient(create_app(settings, factory=fake_factory(), start_monitor=False),
                      base_url="http://localhost", raise_server_exceptions=False)


@pytest.mark.parametrize("value", ["1", "true", "TRUE", "yes", "on", " On "])
def test_debug_env_values_that_turn_it_on(monkeypatch, value):
    monkeypatch.setenv("NETPULSE_DEBUG", value)
    assert Settings.from_env().debug is True


@pytest.mark.parametrize("value", ["", "0", "false", "no", "off", "debug"])
def test_debug_env_values_that_leave_it_off(monkeypatch, value):
    monkeypatch.setenv("NETPULSE_DEBUG", value)
    assert Settings.from_env().debug is False


def test_debug_is_off_by_default(monkeypatch):
    monkeypatch.delenv("NETPULSE_DEBUG", raising=False)
    assert Settings.from_env().debug is False
    assert Settings().debug is False


def test_production_hides_the_api_docs_and_schema(tmp_path):
    with _client(Settings(data_dir=tmp_path / "data")) as c:
        assert c.app.debug is False
        for path in ("/docs", "/redoc", "/openapi.json"):
            assert c.get(path).status_code == 404, path
        assert c.get("/api/devices").status_code == 200


def test_debug_mode_serves_the_api_docs(tmp_path):
    with _client(Settings(data_dir=tmp_path / "data", debug=True)) as c:
        assert c.app.debug is True
        assert c.get("/docs").status_code == 200
        assert c.get("/openapi.json").json()["info"]["title"] == "NetPulse"


def _boom_body(tmp_path, debug: bool) -> tuple[int, str]:
    app = create_app(Settings(data_dir=tmp_path / "data", debug=debug),
                     factory=fake_factory(), start_monitor=False)

    def boom():
        raise RuntimeError("internal detail")

    app.add_api_route("/api/_boom", boom)
    app.router.routes.insert(0, app.router.routes.pop())  # ahead of the UI's catch-all mount
    with TestClient(app, base_url="http://localhost", raise_server_exceptions=False) as c:
        r = c.get("/api/_boom")
    return r.status_code, r.text


def test_production_errors_carry_no_traceback(tmp_path):
    status, body = _boom_body(tmp_path, debug=False)
    assert status == 500
    assert "internal detail" not in body and "Traceback" not in body


def test_debug_mode_errors_show_the_traceback(tmp_path):
    status, body = _boom_body(tmp_path, debug=True)
    assert status == 500
    assert "internal detail" in body
