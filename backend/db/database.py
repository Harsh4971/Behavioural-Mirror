from sqlalchemy import create_engine, Column, String, Text, DateTime, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime

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
    created_at = Column(DateTime, default=datetime.utcnow)