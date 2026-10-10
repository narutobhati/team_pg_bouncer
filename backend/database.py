from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from config import settings

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False},  # needed for SQLite
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from models import Batch, Call, Fix, PromptVersion, Regression, RootCause, TestResult  # noqa: F401
    Base.metadata.create_all(bind=engine)
    _migrate()


def _migrate():
    """Add new columns to existing tables without dropping data."""
    with engine.connect() as conn:
        existing = {row[1] for row in conn.execute(text("PRAGMA table_info(calls)"))}
        if "call_outcome" not in existing:
            conn.execute(text(
                "ALTER TABLE calls ADD COLUMN call_outcome VARCHAR(30) NOT NULL DEFAULT 'completed'"
            ))
            conn.commit()

        fix_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(fixes)"))}
        if "human_validated" not in fix_cols:
            conn.execute(text("ALTER TABLE fixes ADD COLUMN human_validated BOOLEAN NOT NULL DEFAULT 0"))
            conn.commit()
