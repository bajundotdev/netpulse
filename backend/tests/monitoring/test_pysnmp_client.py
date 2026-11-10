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
