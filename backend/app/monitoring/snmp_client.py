from typing import Any, Protocol

from pysnmp.hlapi.v3arch.asyncio import (
    CommunityData,
    ContextData,
    ObjectIdentity,
    ObjectType,
    SnmpEngine,
    UdpTransportTarget,
    UsmUserData,
    get_cmd,
    usmAesCfb128Protocol,
    usmAesCfb256Protocol,
    usmDESPrivProtocol,
    usmHMAC192SHA256AuthProtocol,
    usmHMACMD5AuthProtocol,
    usmHMACSHAAuthProtocol,
    usmNoAuthProtocol,
    usmNoPrivProtocol,
    walk_cmd,
)
from pyasn1.type.univ import Integer
from pysnmp.proto.rfc1905 import EndOfMibView, NoSuchInstance, NoSuchObject

from app.domain.models import SnmpSettings

_AUTH = {
    "none": usmNoAuthProtocol,
    "MD5": usmHMACMD5AuthProtocol,
    "SHA": usmHMACSHAAuthProtocol,
    "SHA256": usmHMAC192SHA256AuthProtocol,
}
_PRIV = {
    "none": usmNoPrivProtocol,
    "DES": usmDESPrivProtocol,
    "AES128": usmAesCfb128Protocol,
    "AES256": usmAesCfb256Protocol,
}


class SnmpError(Exception):
    pass


class SnmpClient(Protocol):
    async def get(
        self, host: str, settings: SnmpSettings, oids: list[str], timeout_ms: int
    ) -> dict[str, Any]: ...

    async def walk(
        self, host: str, settings: SnmpSettings, base_oid: str, timeout_ms: int
    ) -> dict[str, Any]: ...


def _plain(value: Any) -> Any:
    if isinstance(value, (NoSuchObject, NoSuchInstance, EndOfMibView)):
        raise SnmpError("no such object")
    if isinstance(value, Integer):
        return int(value)
    return value.prettyPrint()


def _oid(name: Any) -> str:
    return str(name).lstrip(".")


class PysnmpClient:
    def __init__(self) -> None:
        self._engine: SnmpEngine | None = None

    def _get_engine(self) -> SnmpEngine:
        if self._engine is None:
            self._engine = SnmpEngine()
        return self._engine

    def _auth_data(self, s: SnmpSettings) -> CommunityData | UsmUserData:
        if s.version == "v3":
            return UsmUserData(
                s.user or "",
                authKey=s.auth_key if s.auth_proto != "none" else None,
                privKey=s.priv_key if s.priv_proto != "none" else None,
                authProtocol=_AUTH[s.auth_proto],
                privProtocol=_PRIV[s.priv_proto],
            )
        return CommunityData(s.community or "", mpModel=1)

    async def _target(self, host: str, s: SnmpSettings, timeout_ms: int) -> UdpTransportTarget:
        return await UdpTransportTarget.create(
            (host, s.port), timeout=timeout_ms / 1000, retries=0
        )

    @staticmethod
    def _check(error_indication: Any, error_status: Any) -> None:
        if error_indication:
            raise SnmpError(str(error_indication))
        if error_status:
            raise SnmpError(error_status.prettyPrint())

    async def get(
        self, host: str, settings: SnmpSettings, oids: list[str], timeout_ms: int
    ) -> dict[str, Any]:
        err_ind, err_status, _, var_binds = await get_cmd(
            self._get_engine(),
            self._auth_data(settings),
            await self._target(host, settings, timeout_ms),
            ContextData(),
            *(ObjectType(ObjectIdentity(o)) for o in oids),
        )
        self._check(err_ind, err_status)
        return {_oid(name): _plain(value) for name, value in var_binds}

    async def walk(
        self, host: str, settings: SnmpSettings, base_oid: str, timeout_ms: int
    ) -> dict[str, Any]:
        base = _oid(base_oid)
        out: dict[str, Any] = {}
        async for err_ind, err_status, _, var_binds in walk_cmd(
            self._get_engine(),
            self._auth_data(settings),
            await self._target(host, settings, timeout_ms),
            ContextData(),
            ObjectType(ObjectIdentity(base)),
            lexicographicMode=False,
        ):
            self._check(err_ind, err_status)
            for name, value in var_binds:
                oid = _oid(name)
                if not oid.startswith(base + "."):
                    return out
                out[oid] = _plain(value)
        return out
