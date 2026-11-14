from __future__ import annotations

import asyncio
from datetime import UTC
from typing import Any

from app.domain.models import DeviceConfig
from app.infra.bus import EventBus
from app.infra.db import CheckRow, DeviceRow
from app.infra.repositories import CheckRepository, DeviceRepository
from app.monitoring.monitor import Monitor
from app.monitoring.status_store import StatusStore
from app.schemas import (
    SNMP_CHECK_TYPES,
    CheckIn,
    CheckOut,
    DeviceIn,
    DeviceOut,
    DeviceStatusOut,
    DeviceUpdate,
    ResultOut,
    SnmpIn,
    SnmpOut,
    url_host,
    validate_liveness,
    validate_timing,
    validate_web,
)
from app.services.events import RunDb

# Columns that accept an explicit null in an update; null elsewhere means "unchanged".
_NULLABLE = {"liveness_port", "notes", "url"}

_SNMP_CLEARED = {
    "snmp_version": None,
    "snmp_port": 161,
    "snmp_user": None,
    "snmp_auth_proto": "none",
    "snmp_priv_proto": "none",
    "snmp_community": "",
    "snmp_auth_key": "",
    "snmp_priv_key": "",
}


class ValidationFailed(Exception):
    """A request that is valid on its own but inconsistent with the stored device (HTTP 422)."""


def _snmp_fields(snmp: SnmpIn | None) -> dict[str, Any]:
    if snmp is None:
        return dict(_SNMP_CLEARED)
    fields: dict[str, Any] = {
        "snmp_version": snmp.version,
        "snmp_port": snmp.port,
        "snmp_user": snmp.user,
        "snmp_auth_proto": snmp.auth_proto,
        "snmp_priv_proto": snmp.priv_proto,
        "snmp_community": snmp.community,
        "snmp_auth_key": snmp.auth_key,
        "snmp_priv_key": snmp.priv_key,
    }
    if snmp.version == "v2c":  # drop v3 leftovers
        fields.update(snmp_user=None, snmp_auth_proto="none", snmp_priv_proto="none",
                      snmp_auth_key="", snmp_priv_key="")
    else:  # drop the v2c community
        fields["snmp_community"] = ""
    return fields


def _validate_merged_snmp(snmp: SnmpIn, stored: dict[str, bool]) -> None:
    """The SNMP settings an update leaves behind must be usable.

    A secret counts when sent now (non-empty) or, when omitted (None), already stored.
    """
    def present(sent: str | None, flag: str) -> bool:
        return bool(sent) if sent is not None else stored[flag]

    if snmp.version == "v2c":
        if not present(snmp.community, "has_community"):
            raise ValidationFailed("SNMPv2c requires a community")
        return
    if not snmp.user:
        raise ValidationFailed("SNMPv3 requires a user")
    if snmp.auth_proto != "none" and not present(snmp.auth_key, "has_auth_key"):
        raise ValidationFailed("SNMPv3 authentication requires an auth key")
    if snmp.priv_proto != "none":
        if snmp.auth_proto == "none":
            raise ValidationFailed("SNMPv3 privacy requires authentication")
        if not present(snmp.priv_key, "has_priv_key"):
            raise ValidationFailed("SNMPv3 privacy requires a priv key")


def _utc(dt):
    return dt.replace(tzinfo=UTC)


def _check_out(row: CheckRow, has_secret: bool = False) -> CheckOut:
    return CheckOut(
        id=row.id,
        device_id=row.device_id,
        type=row.type,
        params=dict(row.params or {}),
        enabled=row.enabled,
        has_secret=has_secret,
        created_at=_utc(row.created_at),
    )


class DeviceService:
    def __init__(
        self,
        devices: DeviceRepository,
        checks: CheckRepository,
        monitor: Monitor,
        store: StatusStore,
        bus: EventBus,
        run: RunDb = asyncio.to_thread,
    ) -> None:
        self._devices = devices
        self._checks = checks
        self._monitor = monitor
        self._store = store
        self._bus = bus
        self._run = run

    async def _changed(self, device_id: int, change: str) -> None:
        """Tells open pages (other tabs, API users) to reload the device list."""
        await self._bus.publish("devices", {"device_id": device_id, "change": change})

    # ---- helpers (blocking; run in a worker thread) ----

    def _check_row_out(self, row: CheckRow) -> CheckOut:
        return _check_out(row, self._checks.has_secret(row))

    def _out(self, row: DeviceRow) -> DeviceOut:
        snmp = None
        if row.snmp_version is not None:
            snmp = SnmpOut(
                version=row.snmp_version,
                port=row.snmp_port,
                user=row.snmp_user,
                auth_proto=row.snmp_auth_proto,
                priv_proto=row.snmp_priv_proto,
                **self._devices.secret_flags(row),
            )
        return DeviceOut(
            id=row.id,
            name=row.name,
            host=row.host,
            kind=row.kind,
            enabled=row.enabled,
            interval_s=row.interval_s,
            fail_threshold=row.fail_threshold,
            timeout_ms=row.timeout_ms,
            liveness=row.liveness,
            liveness_port=row.liveness_port,
            url=row.url,
            snmp=snmp,
            notes=row.notes,
            checks=[self._check_row_out(c) for c in self._checks.list_for_device(row.id)],
            created_at=_utc(row.created_at),
            updated_at=_utc(row.updated_at),
        )

    def _config(self, device_id: int) -> DeviceConfig:
        return self._devices.to_config(self._devices.get(device_id))

    def _require_snmp(self, device_id: int) -> None:
        if self._devices.get(device_id).snmp_version is None:
            raise ValidationFailed("SNMP checks require SNMP settings on the device")

    def _require_secret(self, data: CheckIn, stored: bool) -> None:
        """An auth setting without any secret (sent now or kept) would send nothing."""
        if data.type == "http" and data.params.get("auth") and not data.secret and not stored:
            raise ValidationFailed("auth needs a secret")

    def _create_sync(self, data: DeviceIn) -> tuple[DeviceOut, DeviceConfig]:
        for check in data.checks:  # validate everything before the first write
            self._require_secret(check, stored=False)
        fields = data.model_dump(exclude={"snmp", "checks"})
        fields.update(_snmp_fields(data.snmp))
        row = self._devices.create(fields)
        for check in data.checks:
            self._checks.create(row.id, check.model_dump())
        return self._out(row), self._devices.to_config(row)

    def _update_sync(self, id: int, data: DeviceUpdate) -> tuple[DeviceOut, DeviceConfig]:
        current = self._devices.get(id)
        sent = data.model_dump(exclude_unset=True, exclude={"snmp"})
        fields = {k: v for k, v in sent.items() if v is not None or k in _NULLABLE}
        try:
            validate_timing(
                fields.get("interval_s", current.interval_s),
                fields.get("timeout_ms", current.timeout_ms),
            )
            kind = fields.get("kind", current.kind)
            url = fields.get("url", current.url)
            liveness = fields.get("liveness", current.liveness)
            validate_liveness(liveness, fields.get("liveness_port", current.liveness_port), url)
            validate_web(kind, liveness, url)
            if kind == "web" and "host" not in fields and (
                "url" in fields or current.kind != "web"
            ):
                fields["host"] = url_host(url) or current.host  # host follows the url
        except ValueError as exc:
            raise ValidationFailed(str(exc)) from exc
        if "snmp" in data.model_fields_set:
            if data.snmp is not None:
                _validate_merged_snmp(data.snmp, self._devices.secret_flags(current))
            fields.update(_snmp_fields(data.snmp))
            if data.snmp is None and any(
                c.type in SNMP_CHECK_TYPES for c in self._checks.list_for_device(id)
            ):
                raise ValidationFailed("delete the device's SNMP checks before removing SNMP")
        row = self._devices.update(id, fields)
        return self._out(row), self._devices.to_config(row)

    def _status_row(self, row: DeviceRow) -> DeviceStatusOut:
        state = self._store.state(row.id)
        if state is not None:
            status, since, failures = state.status.value, state.since, state.consecutive_failures
        else:
            status, since, failures = ("UNKNOWN" if row.enabled else "PAUSED"), None, 0
        return DeviceStatusOut(
            device_id=row.id,
            name=row.name,
            status=status,
            since=since,
            consecutive_failures=failures,
            results=[ResultOut(**{**r.__dict__, "type": r.type.value})
                     for r in self._store.results(row.id)],
            latency=self._store.latency(row.id),
        )

    # ---- use cases ----

    async def list(self) -> list[DeviceOut]:
        return await self._run(lambda: [self._out(r) for r in self._devices.list()])

    async def configs(self) -> list[DeviceConfig]:
        return await self._run(
            lambda: [self._devices.to_config(r) for r in self._devices.list()]
        )

    async def get(self, id: int) -> DeviceOut:
        return await self._run(lambda: self._out(self._devices.get(id)))

    async def create(self, data: DeviceIn) -> DeviceOut:
        out, config = await self._run(self._create_sync, data)
        await self._monitor.upsert(config)
        await self._changed(out.id, "created")
        return out

    async def update(self, id: int, data: DeviceUpdate) -> DeviceOut:
        out, config = await self._run(self._update_sync, id, data)
        await self._monitor.upsert(config)
        await self._changed(id, "updated")
        return out

    async def delete(self, id: int) -> None:
        await self._run(self._devices.delete, id)
        await self._monitor.remove(id)
        self._store.remove(id)
        await self._changed(id, "deleted")

    async def test(self, id: int) -> list[ResultOut]:
        config = await self._run(self._config, id)
        results = await self._monitor.test(config)
        return [ResultOut(**{**r.__dict__, "type": r.type.value}) for r in results]

    async def list_checks(self, device_id: int) -> list[CheckOut]:
        def run() -> list[CheckOut]:
            self._devices.get(device_id)
            return [self._check_row_out(c) for c in self._checks.list_for_device(device_id)]

        return await self._run(run)

    async def add_check(self, device_id: int, data: CheckIn) -> CheckOut:
        def run() -> tuple[CheckOut, DeviceConfig]:
            if data.type in SNMP_CHECK_TYPES:
                self._require_snmp(device_id)
            self._require_secret(data, stored=False)
            row = self._checks.create(device_id, data.model_dump())
            return self._check_row_out(row), self._config(device_id)

        out, config = await self._run(run)
        await self._monitor.upsert(config)
        await self._changed(config.id, "updated")
        return out

    async def update_check(self, id: int, data: CheckIn) -> CheckOut:
        def run() -> tuple[CheckOut, DeviceConfig]:
            current = self._checks.get(id)
            device_id = current.device_id
            if data.type in SNMP_CHECK_TYPES:
                self._require_snmp(device_id)
            # A kept secret only counts for the same kind of check.
            kept = current.type == "http" and data.type == "http" and self._checks.has_secret(current)
            self._require_secret(data, stored=kept and data.secret is None)
            row = self._checks.update(id, data.model_dump())
            return self._check_row_out(row), self._config(device_id)

        out, config = await self._run(run)
        await self._monitor.upsert(config)
        await self._changed(config.id, "updated")
        return out

    async def delete_check(self, id: int) -> None:
        def run() -> DeviceConfig:
            device_id = self._checks.get(id).device_id
            self._checks.delete(id)
            return self._config(device_id)

        config = await self._run(run)
        await self._monitor.upsert(config)
        await self._changed(config.id, "updated")

    async def status(self) -> list[DeviceStatusOut]:
        return await self._run(lambda: [self._status_row(r) for r in self._devices.list()])
