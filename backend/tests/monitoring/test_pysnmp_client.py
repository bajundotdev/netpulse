from pysnmp.hlapi.v3arch.asyncio import (
    CommunityData,
    UsmUserData,
    usmAesCfb256Protocol,
    usmHMAC192SHA256AuthProtocol,
    usmHMACMD5AuthProtocol,
    usmNoAuthProtocol,
    usmNoPrivProtocol,
)

from app.domain.models import SnmpSettings
from app.monitoring.snmp_client import PysnmpClient


def test_pysnmp_client_builds_v3_auth():
    s = SnmpSettings("v3", user="admin", auth_proto="SHA256", auth_key="authsecret1",
                     priv_proto="AES256", priv_key="privsecret1")
    data = PysnmpClient()._auth_data(s)
    assert isinstance(data, UsmUserData)
    assert data.authentication_protocol == usmHMAC192SHA256AuthProtocol
    assert data.privacy_protocol == usmAesCfb256Protocol


def test_v3_auth_only_and_noauth():
    c = PysnmpClient()
    d = c._auth_data(SnmpSettings("v3", user="u", auth_proto="MD5", auth_key="authsecret1"))
    assert d.authentication_protocol == usmHMACMD5AuthProtocol and d.privacy_protocol == usmNoPrivProtocol
    d = c._auth_data(SnmpSettings("v3", user="u"))
    assert d.authentication_protocol == usmNoAuthProtocol and d.privacy_protocol == usmNoPrivProtocol


def test_v2c_uses_community():
    d = PysnmpClient()._auth_data(SnmpSettings("v2c", community="public"))
    assert isinstance(d, CommunityData) and d.message_processing_model == 1


def test_construction_does_not_create_engine():
    assert PysnmpClient()._engine is None


async def test_walk_uses_one_bulk_request_stream(monkeypatch):
    from app.monitoring import snmp_client

    seen = {}

    async def fake_bulk_walk(engine, auth, target, ctx, non_repeaters, max_repetitions, var_bind,
                             **options):
        seen.update(non_repeaters=non_repeaters, max_repetitions=max_repetitions, options=options)
        base = "1.3.6.1.2.1.2.2.1.8"
        yield None, 0, 0, [(f"{base}.1", snmp_client.Integer(1)),
                           (f"{base}.2", snmp_client.Integer(2)),
                           ("1.3.6.1.2.1.2.2.1.9.1", snmp_client.Integer(0))]  # past the column

    def no_plain_walk(*a, **k):
        raise AssertionError("walk_cmd must not be used")

    async def fake_target(self, host, s, timeout_ms):
        return object()

    monkeypatch.setattr(snmp_client, "bulk_walk_cmd", fake_bulk_walk)
    monkeypatch.setattr(snmp_client, "walk_cmd", no_plain_walk, raising=False)
    monkeypatch.setattr(PysnmpClient, "_target", fake_target)
    c = PysnmpClient()
    monkeypatch.setattr(c, "_get_engine", lambda: object())
    got = await c.walk("10.0.0.1", SnmpSettings("v2c", community="public"),
                       "1.3.6.1.2.1.2.2.1.8", 1000)
    assert got == {"1.3.6.1.2.1.2.2.1.8.1": 1, "1.3.6.1.2.1.2.2.1.8.2": 2}
    assert seen["non_repeaters"] == 0 and seen["max_repetitions"] == 25
    assert seen["options"].get("lexicographicMode") is False
