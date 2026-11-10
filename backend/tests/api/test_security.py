from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app.config import Settings
from app.api.guard import allowed_hosts
from app.main import create_app
from tests.api.conftest import fake_factory

SW = {"name": "SW1", "host": "10.0.0.2"}


def test_foreign_host_header_is_rejected(client):
    assert client.get("/api/health", headers={"Host": "evil.example"}).status_code == 400
    assert client.get("/api/health", headers={"Host": "evil.example:8765"}).status_code == 400
    for host in ("localhost:8765", "127.0.0.1:8765", "[::1]:8765"):
        assert client.get("/api/health", headers={"Host": host}).status_code == 200


def test_mutation_from_foreign_origin_is_403(client):
    r = client.post("/api/devices", json=SW, headers={"Origin": "http://evil.example"})
    assert r.status_code == 403
    r = client.delete("/api/events", headers={"Origin": "http://localhost:9999"})
    assert r.status_code == 403
    # reads are not blocked by Origin; same-origin writes and writes without Origin pass
    assert client.get("/api/devices", headers={"Origin": "http://evil.example"}).status_code == 200
    r = client.post("/api/devices", json=SW, headers={"Origin": "http://localhost:8765"})
    assert r.status_code == 201
    assert client.post("/api/devices", json={**SW, "name": "SW2"}).status_code == 201


def test_allowed_hosts_for_loopback_and_lan_binding():
    assert allowed_hosts(Settings()) == ["localhost", "127.0.0.1", "[::1]"]
    lan = Settings(host="10.0.0.5", allowed_hosts=("netpulse.corp.local",))
    assert allowed_hosts(lan) == ["localhost", "127.0.0.1", "[::1]", "10.0.0.5", "netpulse.corp.local"]
    # extra names only apply when the server is reachable beyond loopback
    assert "x.example" not in allowed_hosts(Settings(allowed_hosts=("x.example",)))


def test_settings_reads_allowed_hosts_from_env(monkeypatch):
    monkeypatch.setenv("NETPULSE_ALLOWED_HOSTS", " a.example , b.example,")
    assert Settings.from_env().allowed_hosts == ("a.example", "b.example")


def test_lost_secret_key_does_not_block_startup(settings):
    app = create_app(settings, factory=fake_factory(), start_monitor=False)
    with TestClient(app, base_url="http://localhost") as c:
        d = c.post("/api/devices", json={**SW, "snmp": {"version": "v2c", "community": "public"}}).json()
        assert d["snmp"]["has_community"] is True
    settings.key_path.write_bytes(Fernet.generate_key())  # key file lost and recreated

    app = create_app(settings, factory=fake_factory(), start_monitor=True)
    with TestClient(app, base_url="http://localhost") as c:
        got = c.get(f"/api/devices/{d['id']}").json()
        assert got["snmp"]["has_community"] is False
        configs = c.portal.call(c.app.state.container.devices.configs)
        assert configs[0].snmp.community is None
