import os
from pathlib import Path

from sqlalchemy import text
from sqlmodel import Session, SQLModel, create_engine

DB_PATH = Path(os.environ.get("TRUST_LAYER_DB", Path(__file__).resolve().parent / "trust_layer.db"))
DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})


# Columns added after the first release. create_all() never alters an existing
# table, so older databases get these via ALTER TABLE (SQLite needs a constant
# DEFAULT to add a NOT NULL column).
SUBMISSION_COLUMNS = {
    "photo_verdict": "VARCHAR NOT NULL DEFAULT 'unverified'",
    "photo_quality_score": "FLOAT NOT NULL DEFAULT 0.0",
    "quality_flags": "VARCHAR NOT NULL DEFAULT '[]'",
    "photo_override": "BOOLEAN NOT NULL DEFAULT 0",
    "client_mismatch": "BOOLEAN NOT NULL DEFAULT 0",
    "photo_report": "VARCHAR NOT NULL DEFAULT '{}'",
    "photo_path": "VARCHAR",
    "photo_sha256": "VARCHAR",
    "photo_dhash": "VARCHAR",
}


def migrate(connection=None):
    own = connection is None
    conn = connection or engine.connect()
    try:
        have = {row[1] for row in conn.execute(text("PRAGMA table_info(submission)"))}
        if have:  # table exists (a fresh DB was just created with every column)
            for col, ddl in SUBMISSION_COLUMNS.items():
                if col not in have:
                    conn.execute(text(f"ALTER TABLE submission ADD COLUMN {col} {ddl}"))
        conn.commit()
    finally:
        if own:
            conn.close()


def init_db():
    # Import models so their tables are registered on SQLModel.metadata.
    import models  # noqa: F401

    SQLModel.metadata.create_all(engine)
    migrate()


def get_session():
    with Session(engine) as session:
        yield session
