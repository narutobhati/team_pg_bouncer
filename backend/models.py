from datetime import datetime
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON
from database import Base


class Batch(Base):
    __tablename__ = "batches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    label: Mapped[str] = mapped_column(String(120))
    total: Mapped[int] = mapped_column(Integer)
    processed: Mapped[int] = mapped_column(Integer, default=0)
    prompt_version: Mapped[str] = mapped_column(String(20))
    stage: Mapped[str] = mapped_column(String(20), default="queued")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    clustered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    calls: Mapped[list["Call"]] = relationship("Call", back_populates="batch")


class Call(Base):
    __tablename__ = "calls"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    call_id: Mapped[str] = mapped_column(String(20))          # CL-1001
    batch_id: Mapped[int] = mapped_column(Integer, ForeignKey("batches.id"))
    file_name: Mapped[str] = mapped_column(String(255))
    prompt_version: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    duration_sec: Mapped[int] = mapped_column(Integer, default=0)
    language: Mapped[str] = mapped_column(String(10), default="hi-IN")
    overall_confidence: Mapped[float] = mapped_column(Float, default=0.0)

    # Grading fields — populated in Phase 2
    grade: Mapped[str] = mapped_column(String(20), default="Non-Fatal")
    call_outcome: Mapped[str] = mapped_column(String(30), default="completed")
    category: Mapped[str | None] = mapped_column(String(30), nullable=True)
    reason: Mapped[str] = mapped_column(Text, default="Pending grading")
    evidence: Mapped[str] = mapped_column(Text, default="")
    evidence_timestamp: Mapped[str] = mapped_column(String(10), default="00:00")
    evidence_turn: Mapped[int | None] = mapped_column(Integer, nullable=True)

    risky_flags: Mapped[list] = mapped_column(JSON, default=list)
    reviewed: Mapped[bool] = mapped_column(Boolean, default=False)
    root_cause_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Transcript verification
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    audio_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)

    # Transcripts stored as JSON arrays of Turn dicts
    transcript: Mapped[list] = mapped_column(JSON, default=list)
    verbatim_transcript: Mapped[list | None] = mapped_column(JSON, nullable=True)
    simulated_transcript: Mapped[list | None] = mapped_column(JSON, nullable=True)
    simulated_grade: Mapped[str | None] = mapped_column(String(20), nullable=True)

    batch: Mapped["Batch"] = relationship("Batch", back_populates="calls")


class RootCause(Base):
    __tablename__ = "root_causes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    batch_id: Mapped[int] = mapped_column(Integer, ForeignKey("batches.id"))
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text)
    type: Mapped[str] = mapped_column(String(30))   # "Prompt Issue" | "ASR Issue" | "Knowledge Gap" | "Flow Logic"
    call_ids: Mapped[list] = mapped_column(JSON, default=list)   # list of Call.id (int)
    frequency: Mapped[float] = mapped_column(Float, default=0.0) # affected / total in batch
    severity: Mapped[float] = mapped_column(Float, default=1.0)  # fatal / affected
    priority_score: Mapped[int] = mapped_column(Integer, default=0)
    fixed: Mapped[bool] = mapped_column(Boolean, default=False)
    regressed: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    fix_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    snippets: Mapped[list] = mapped_column(JSON, default=list)   # [{call_id, lines:[Turn]}]


class Fix(Base):
    __tablename__ = "fixes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    root_cause_id: Mapped[int] = mapped_column(Integer, ForeignKey("root_causes.id"))
    root_cause_name: Mapped[str] = mapped_column(String(100))
    prompt_version: Mapped[str] = mapped_column(String(20))
    current_excerpt: Mapped[str] = mapped_column(Text, default="")
    proposed_change: Mapped[str] = mapped_column(Text)
    rationale: Mapped[str] = mapped_column(Text)
    expected_calls_repaired: Mapped[int] = mapped_column(Integer, default=0)
    affected_calls: Mapped[int] = mapped_column(Integer, default=0)
    priority_score: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(30), default="Pending Review")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    applied_in: Mapped[str | None] = mapped_column(String(20), nullable=True)
    human_validated: Mapped[bool] = mapped_column(Boolean, default=False)


class TestResult(Base):
    __tablename__ = "test_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    fix_id: Mapped[int] = mapped_column(Integer, ForeignKey("fixes.id"))
    root_cause_id: Mapped[int] = mapped_column(Integer)
    root_cause_name: Mapped[str] = mapped_column(String(100))
    prompt_before: Mapped[str] = mapped_column(Text)
    prompt_after: Mapped[str] = mapped_column(Text)
    replayed: Mapped[int] = mapped_column(Integer, default=0)
    before_fatal: Mapped[int] = mapped_column(Integer, default=0)
    after_fatal: Mapped[int] = mapped_column(Integer, default=0)
    repaired: Mapped[int] = mapped_column(Integer, default=0)
    still_failing: Mapped[int] = mapped_column(Integer, default=0)
    regressed: Mapped[int] = mapped_column(Integer, default=0)
    seconds_to_fix: Mapped[int] = mapped_column(Integer, default=0)
    verdict: Mapped[str] = mapped_column(String(20))
    completed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    replayed_calls: Mapped[list] = mapped_column(JSON, default=list)


class Regression(Base):
    __tablename__ = "regressions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    root_cause_name: Mapped[str] = mapped_column(String(100))
    fixed_in: Mapped[str] = mapped_column(String(20))
    batch_id: Mapped[int] = mapped_column(Integer)
    frequency: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class PromptVersion(Base):
    __tablename__ = "prompt_versions"

    version: Mapped[str] = mapped_column(String(20), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    based_on: Mapped[str | None] = mapped_column(String(20), nullable=True)
    fixes_applied: Mapped[list] = mapped_column(JSON, default=list)
    fixed_root_causes: Mapped[list] = mapped_column(JSON, default=list)
    text: Mapped[str] = mapped_column(Text)
    diff: Mapped[list] = mapped_column(JSON, default=list)
    fatal_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    projected_fatal_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    calls_applied: Mapped[int] = mapped_column(Integer, default=0)
    batch_ids: Mapped[list] = mapped_column(JSON, default=list)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
