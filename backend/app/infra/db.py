from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    create_engine,
    event,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

from app.infra.migrate import migrate


def _utcnow() -> datetime:
    # SQLite drops tzinfo, so naive UTC is stored and UTC is re-attached on read.
    return datetime.now(UTC).replace(tzinfo=None)


class Base(DeclarativeBase):
    pass


class DeviceRow(Base):
    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    host: Mapped[str] = mapped_column(String, nullable=False)
    kind: Mapped[str] = mapped_column(String, default="other")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    interval_s: Mapped[int] = mapped_column(Integer, default=5)
    fail_threshold: Mapped[int] = mapped_column(Integer, default=2)
    timeout_ms: Mapped[int] = mapped_column(Integer, default=1000)
    liveness: Mapped[str] = mapped_column(String, default="ping")
    liveness_port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    snmp_version: Mapped[str | None] = mapped_column(String, nullable=True)
    snmp_port: Mapped[int] = mapped_column(Integer, default=161)
    snmp_community_enc: Mapped[str | None] = mapped_column(String, nullable=True)
    snmp_user: Mapped[str | None] = mapped_column(String, nullable=True)
    snmp_auth_proto: Mapped[str] = mapped_column(String, default="none")
    snmp_auth_key_enc: Mapped[str | None] = mapped_column(String, nullable=True)
    snmp_priv_proto: Mapped[str] = mapped_column(String, default="none")
    snmp_priv_key_enc: Mapped[str | None] = mapped_column(String, nullable=True)
    url: Mapped[str | None] = mapped_column(String, nullable=True)
    notes: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow)


class CheckRow(Base):
    __tablename__ = "checks"
    __table_args__ = {"sqlite_autoincrement": True}  # never reuse ids after a delete

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    device_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False
    )
    type: Mapped[str] = mapped_column(String, nullable=False)
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    secret_enc: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class EventRow(Base):
    __tablename__ = "events"
    __table_args__ = {"sqlite_autoincrement": True}  # never reuse ids after a clear

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    device_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("devices.id", ondelete="SET NULL"), nullable=True
    )
    check_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    severity: Mapped[str] = mapped_column(String, nullable=False)
    kind: Mapped[str] = mapped_column(String, nullable=False)
    message: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str | None] = mapped_column(String, nullable=True)
    previous_status: Mapped[str | None] = mapped_column(String, nullable=True)
    acknowledged: Mapped[bool] = mapped_column(Boolean, default=False)


class StatusHistoryRow(Base):
    __tablename__ = "status_history"
    __table_args__ = (
        Index("ix_status_history_device_ts", "device_id", "ts"),
        {"sqlite_autoincrement": True},  # ids order rows that share a timestamp
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    device_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String, nullable=False)
    ts: Mapped[datetime] = mapped_column(DateTime, nullable=False)


def make_session_factory(db_path: Path) -> sessionmaker:
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _enable_foreign_keys(dbapi_conn, _record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(engine)
    migrate(engine)
    return sessionmaker(engine, expire_on_commit=False)
