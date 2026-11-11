from sqlalchemy import Engine, text

# (table, column, DDL) added after the first release; create_all never alters existing tables.
_COLUMNS = (
    ("devices", "url", "ALTER TABLE devices ADD COLUMN url VARCHAR"),
    ("checks", "secret_enc", "ALTER TABLE checks ADD COLUMN secret_enc VARCHAR"),
)


def migrate(engine: Engine) -> list[str]:
    """Add missing columns to existing tables; returns the statements applied (idempotent)."""
    applied: list[str] = []
    with engine.begin() as conn:
        for table, column, ddl in _COLUMNS:
            existing = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}
            if existing and column not in existing:
                conn.execute(text(ddl))
                applied.append(ddl)
    return applied
