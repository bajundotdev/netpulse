from sqlalchemy import create_engine, text

from app.infra.migrate import migrate

OLD_SCHEMA = [
    """CREATE TABLE devices (
        id INTEGER NOT NULL PRIMARY KEY, name VARCHAR NOT NULL UNIQUE, host VARCHAR NOT NULL,
        kind VARCHAR, enabled BOOLEAN, interval_s INTEGER, fail_threshold INTEGER,
        timeout_ms INTEGER, liveness VARCHAR, liveness_port INTEGER, snmp_version VARCHAR,
        snmp_port INTEGER, snmp_community_enc VARCHAR, snmp_user VARCHAR,
        snmp_auth_proto VARCHAR, snmp_auth_key_enc VARCHAR, snmp_priv_proto VARCHAR,
        snmp_priv_key_enc VARCHAR, notes VARCHAR, created_at DATETIME, updated_at DATETIME)""",
    """CREATE TABLE checks (
        id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        device_id INTEGER NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
        type VARCHAR NOT NULL, params JSON, enabled BOOLEAN, created_at DATETIME)""",
    """CREATE TABLE events (
        id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, ts DATETIME,
        device_id INTEGER REFERENCES devices (id) ON DELETE SET NULL, check_id INTEGER,
        severity VARCHAR NOT NULL, kind VARCHAR NOT NULL, message VARCHAR NOT NULL,
        status VARCHAR, previous_status VARCHAR, acknowledged BOOLEAN)""",
    """CREATE TABLE status_history (
        id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        device_id INTEGER NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
        status VARCHAR NOT NULL, ts DATETIME NOT NULL)""",
    "INSERT INTO devices (id, name, host) VALUES (1, 'DC01', '10.0.0.1')",
    "INSERT INTO checks (device_id, type, params) VALUES (1, 'tcp', '{\"port\": 53}')",
    "INSERT INTO events (device_id, severity, kind, message) VALUES (1, 'info', 'status_change', 'x')",
    "INSERT INTO status_history (device_id, status, ts) VALUES (1, 'UP', '2026-01-01 00:00:00')",
]


def _columns(conn, table: str) -> set[str]:
    return {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}


def test_migrates_old_schema_keeping_rows(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with engine.begin() as conn:
        for stmt in OLD_SCHEMA:
            conn.execute(text(stmt))

    applied = migrate(engine)

    assert applied == [
        "ALTER TABLE devices ADD COLUMN url VARCHAR",
        "ALTER TABLE checks ADD COLUMN secret_enc VARCHAR",
    ]
    with engine.connect() as conn:
        assert "url" in _columns(conn, "devices")
        assert "secret_enc" in _columns(conn, "checks")
        assert conn.execute(text("SELECT name, host, url FROM devices")).one() == (
            "DC01", "10.0.0.1", None,
        )
        assert conn.execute(text("SELECT type, secret_enc FROM checks")).one() == ("tcp", None)
        assert conn.execute(text("SELECT count(*) FROM events")).scalar() == 1
        assert conn.execute(text("SELECT count(*) FROM status_history")).scalar() == 1
    assert migrate(engine) == []
    engine.dispose()


def test_fresh_schema_needs_no_migration(session_factory):
    assert migrate(session_factory.kw["bind"]) == []
