from sqlalchemy import create_engine, Column, String, Text, DateTime, Boolean, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime, timezone

def _utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)

SQLALCHEMY_DATABASE_URL = "sqlite:///./behavioral_mirror.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class Session(Base):
    __tablename__ = "sessions"

    id = Column(String, primary_key=True)
    user_id = Column(String, index=True)
    context = Column(String)
    filename = Column(String, default="recording")
    detected_speaker = Column(String, default="SPEAKER_00")
    speaker_confirmed = Column(Boolean, default=False)
    signals_json = Column(Text)
    insights_json = Column(Text)
    dimensions_json = Column(Text)
    merged_json = Column(Text, nullable=True)
    all_speakers_signals_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow)


class UserVoiceprint(Base):
    __tablename__ = "user_voiceprints"

    user_id = Column(String, primary_key=True)
    embedding_json = Column(Text, nullable=False)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)


def run_migrations(engine):
    """Add columns introduced after initial schema creation. Safe to run on every startup."""
    new_columns = [
        ("sessions", "merged_json", "TEXT"),
        ("sessions", "all_speakers_signals_json", "TEXT"),
    ]
    with engine.connect() as conn:
        for table, col, col_type in new_columns:
            try:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}"))
                conn.commit()
            except Exception:
                pass  # column already exists