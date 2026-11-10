from datetime import UTC

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.domain.models import CheckConfig, CheckType, DeviceConfig, DomainEvent, SnmpSettings
from app.infra.crypto import SecretBox
from app.infra.db import CheckRow, DeviceRow, EventRow


class DuplicateNameError(Exception):
    pass


class NotFoundError(Exception):
    pass


# plain API field -> encrypted column
_SECRET_FIELDS = {
    "snmp_community": "snmp_community_enc",
    "snmp_auth_key": "snmp_auth_key_enc",
    "snmp_priv_key": "snmp_priv_key_enc",
}


class DeviceRepository:
    def __init__(self, session_factory: sessionmaker, box: SecretBox):
        self._sf = session_factory
        self._box = box

    def list(self) -> list[DeviceRow]:
        with self._sf() as s:
            return list(s.scalars(select(DeviceRow).order_by(DeviceRow.id)))

    def get(self, id: int) -> DeviceRow:
        with self._sf() as s:
            row = s.get(DeviceRow, id)
            if row is None:
                raise NotFoundError(f"device {id}")
            return row

    def create(self, data: dict) -> DeviceRow:
        row = DeviceRow()
        self._apply(row, data)
        with self._sf() as s:
            s.add(row)
            self._commit(s)
            return row

    def update(self, id: int, data: dict) -> DeviceRow:
        with self._sf() as s:
            row = s.get(DeviceRow, id)
            if row is None:
                raise NotFoundError(f"device {id}")
            self._apply(row, data)
            self._commit(s)
            return row

    def delete(self, id: int) -> None:
        with self._sf() as s:
            row = s.get(DeviceRow, id)
            if row is None:
                raise NotFoundError(f"device {id}")
            s.delete(row)
            s.commit()

    def secret_flags(self, row: DeviceRow) -> dict[str, bool]:
        """has_* flags from successful decryption: an unreadable secret counts as missing."""
        return {
            "has_community": self._box.decrypt(row.snmp_community_enc) is not None,
            "has_auth_key": self._box.decrypt(row.snmp_auth_key_enc) is not None,
            "has_priv_key": self._box.decrypt(row.snmp_priv_key_enc) is not None,
        }

    def to_config(self, row: DeviceRow) -> DeviceConfig:
        snmp = None
        if row.snmp_version is not None:
            snmp = SnmpSettings(
                version=row.snmp_version,
                port=row.snmp_port,
                community=self._box.decrypt(row.snmp_community_enc),
                user=row.snmp_user,
                auth_proto=row.snmp_auth_proto,
                auth_key=self._box.decrypt(row.snmp_auth_key_enc),
                priv_proto=row.snmp_priv_proto,
                priv_key=self._box.decrypt(row.snmp_priv_key_enc),
            )
        with self._sf() as s:
            check_rows = s.scalars(
                select(CheckRow).where(CheckRow.device_id == row.id).order_by(CheckRow.id)
            )
            checks = tuple(
                CheckConfig(c.id, CheckType(c.type), dict(c.params or {}), c.enabled)
                for c in check_rows
            )
        return DeviceConfig(
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
            snmp=snmp,
            checks=checks,
        )

    def _apply(self, row: DeviceRow, data: dict) -> None:
        columns = set(DeviceRow.__table__.columns.keys()) - {"id", "created_at", "updated_at"}
        for key, value in data.items():
            if key in _SECRET_FIELDS:
                if value is None:
                    continue  # keep
                setattr(row, _SECRET_FIELDS[key], None if value == "" else self._box.encrypt(value))
            elif key in columns and key not in _SECRET_FIELDS.values():
                setattr(row, key, value)

    @staticmethod
    def _commit(s) -> None:
        try:
            s.commit()
        except IntegrityError as exc:
            s.rollback()
            raise DuplicateNameError("device name already exists") from exc


class CheckRepository:
    def __init__(self, session_factory: sessionmaker):
        self._sf = session_factory

    def list_for_device(self, device_id: int) -> list[CheckRow]:
        with self._sf() as s:
            return list(
                s.scalars(
                    select(CheckRow).where(CheckRow.device_id == device_id).order_by(CheckRow.id)
                )
            )

    def get(self, id: int) -> CheckRow:
        with self._sf() as s:
            row = s.get(CheckRow, id)
            if row is None:
                raise NotFoundError(f"check {id}")
            return row

    def create(self, device_id: int, data: dict) -> CheckRow:
        with self._sf() as s:
            if s.get(DeviceRow, device_id) is None:
                raise NotFoundError(f"device {device_id}")
            row = CheckRow(
                device_id=device_id,
                type=str(data["type"]),
                params=data.get("params") or {},
                enabled=data.get("enabled", True),
            )
            s.add(row)
            s.commit()
            return row

    def update(self, id: int, data: dict) -> CheckRow:
        with self._sf() as s:
            row = s.get(CheckRow, id)
            if row is None:
                raise NotFoundError(f"check {id}")
            if "type" in data:
                row.type = str(data["type"])
            if "params" in data:
                row.params = data["params"] or {}
            if "enabled" in data:
                row.enabled = data["enabled"]
            s.commit()
            return row

    def delete(self, id: int) -> None:
        with self._sf() as s:
            row = s.get(CheckRow, id)
            if row is None:
                raise NotFoundError(f"check {id}")
            s.delete(row)
            s.commit()


class EventRepository:
    def __init__(self, session_factory: sessionmaker):
        self._sf = session_factory

    def add(self, ev: DomainEvent) -> dict:
        row = EventRow(
            ts=ev.ts.astimezone(UTC).replace(tzinfo=None),
            device_id=ev.device_id,
            check_id=ev.check_id,
            severity=str(ev.severity),
            kind=str(ev.kind),
            message=ev.message,
            status=ev.status,
            previous_status=ev.previous_status,
        )
        with self._sf() as s:
            s.add(row)
            s.commit()
            return self._to_dict(row)

    def list(
        self,
        device_id: int | None = None,
        severity: str | None = None,
        limit: int = 100,
        before_id: int | None = None,
    ) -> list[dict]:
        stmt = select(EventRow)
        if device_id is not None:
            stmt = stmt.where(EventRow.device_id == device_id)
        if severity is not None:
            stmt = stmt.where(EventRow.severity == str(severity))
        if before_id is not None:
            stmt = stmt.where(EventRow.id < before_id)
        stmt = stmt.order_by(EventRow.id.desc()).limit(limit)
        with self._sf() as s:
            return [self._to_dict(r) for r in s.scalars(stmt)]

    def ack(self, id: int) -> None:
        with self._sf() as s:
            row = s.get(EventRow, id)
            if row is None:
                raise NotFoundError(f"event {id}")
            row.acknowledged = True
            s.commit()

    def clear(self) -> int:
        with self._sf() as s:
            result = s.execute(delete(EventRow))
            s.commit()
            return result.rowcount

    @staticmethod
    def _to_dict(row: EventRow) -> dict:
        return {
            "id": row.id,
            "ts": row.ts.replace(tzinfo=UTC).isoformat(),
            "device_id": row.device_id,
            "check_id": row.check_id,
            "severity": row.severity,
            "kind": row.kind,
            "message": row.message,
            "status": row.status,
            "previous_status": row.previous_status,
            "acknowledged": row.acknowledged,
        }
