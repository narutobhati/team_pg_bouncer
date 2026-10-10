"""Pydantic schemas matching the frontend's types/api.ts wire types exactly."""
from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict


# ── primitives ────────────────────────────────────────────────────────────────

Grade = Literal["Fatal", "Non-Fatal"]
Category = Literal["wrong_capture", "loop", "wrong_info", "incomplete", "ignored_refusal", "empathy_failure", "compliance", "other"]
RiskFlag = Literal["frustration", "loop", "human_request", "low_confidence", "wrong_capture", "not_interested", "pushy", "ignored_concern"]
CallOutcome = Literal["completed", "not_interested", "already_fulfilled", "wrong_person", "callback_requested", "user_dropped", "bot_failed"]
RootCauseType = Literal["Prompt Issue", "ASR Issue", "Knowledge Gap", "Flow Logic"]
Stage = Literal["idle", "queued", "processing", "clustering", "fixing", "testing", "done"]
ReplayStatus = Literal["repaired", "failing", "unchanged"]
FixStatus = Literal["Pending Review", "Approved", "Rejected", "Validated", "Needs Revision"]


# ── transcript turn ────────────────────────────────────────────────────────────

class Turn(BaseModel):
    speaker: Literal["BOT", "USER"]
    text: str
    timestamp: str          # "mm:ss"
    confidence: float       # 0..1
    asr_mismatch: bool = False
    verbatim: str | None = None
    replay_status: ReplayStatus | None = None
    original_text: str | None = None


# ── call ──────────────────────────────────────────────────────────────────────

class CallOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    call_id: str
    batch_id: int
    file_name: str
    prompt_version: str
    created_at: datetime
    duration_sec: int
    language: str
    overall_confidence: float
    grade: Grade
    call_outcome: CallOutcome = "completed"
    category: Category | None = None
    reason: str
    evidence: str
    evidence_timestamp: str
    evidence_turn: int | None = None
    risky_flags: list[RiskFlag]
    reviewed: bool
    root_cause_id: int | None = None
    transcript: list[Turn]
    simulated_transcript: list[Turn] | None = None
    simulated_grade: Grade | None = None
    verified: bool = False
    audio_hash: str | None = None


# ── batch ─────────────────────────────────────────────────────────────────────

class BatchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    label: str
    total: int
    processed: int
    prompt_version: str
    stage: Stage
    created_at: datetime
    completed_at: datetime | None = None
    clustered_at: datetime | None = None


# ── pipeline ──────────────────────────────────────────────────────────────────

class PipelineOut(BaseModel):
    stage: Stage
    batch_id: int | None = None
    processed: int
    total: int
    active_prompt: str


# ── prompt version ────────────────────────────────────────────────────────────

class DiffLine(BaseModel):
    kind: Literal["context", "add", "remove"]
    text: str


class PromptVersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    version: str
    created_at: datetime
    based_on: str | None = None
    fixes_applied: list[int]
    fixed_root_causes: list[str]
    text: str
    diff: list[DiffLine]
    fatal_rate: float | None = None
    projected_fatal_rate: float | None = None
    calls_applied: int
    batch_ids: list[int]
    active: bool


# ── root cause ────────────────────────────────────────────────────────────────

class Snippet(BaseModel):
    call_id: int
    lines: list[Turn]


class RootCauseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    batch_id: int
    name: str
    description: str
    type: RootCauseType
    call_ids: list[int]
    frequency: float
    severity: float
    priority_score: int
    fixed: bool
    regressed: bool | None = None
    fix_id: int | None = None
    snippets: list[Snippet]


# ── fix ───────────────────────────────────────────────────────────────────────

class FixOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    root_cause_id: int
    root_cause_name: str
    prompt_version: str
    current_excerpt: str
    proposed_change: str
    rationale: str
    expected_calls_repaired: int
    affected_calls: int
    priority_score: int
    status: FixStatus
    created_at: datetime
    applied_in: str | None = None


# ── test result ───────────────────────────────────────────────────────────────

class TestResultOut(BaseModel):
    fix_id: int
    root_cause_id: int
    root_cause_name: str
    prompt_before: str
    prompt_after: str
    replayed: int
    before_fatal: int
    after_fatal: int
    repaired: int
    still_failing: int
    regressed: int
    seconds_to_fix: int
    verdict: Literal["Validated", "Needs Revision"]
    completed_at: datetime


class ReplayedCallOut(BaseModel):
    call_id: int
    call_code: str
    before: Grade
    after: Grade
    status: Literal["Repaired", "Still Failing", "Regressed"]
    old_response: str
    new_response: str


# ── regression ────────────────────────────────────────────────────────────────

class RegressionOut(BaseModel):
    id: int
    root_cause_name: str
    fixed_in: str
    batch_id: int
    frequency: float
    created_at: datetime


# ── SSE event payload (matches frontend ServerEvent union) ───────────────────

class SseBatchCreated(BaseModel):
    type: Literal["batch.created"] = "batch.created"
    batch: BatchOut

class SseBatchProgress(BaseModel):
    type: Literal["batch.progress"] = "batch.progress"
    pipeline: PipelineOut

class SseCallGraded(BaseModel):
    type: Literal["call.graded"] = "call.graded"
    call: CallOut

class SseCallUpdated(BaseModel):
    type: Literal["call.updated"] = "call.updated"
    call: CallOut

class SseRootCausesReady(BaseModel):
    type: Literal["root_causes.ready"] = "root_causes.ready"
    batch_id: int
    count: int

class SseFixesReady(BaseModel):
    type: Literal["fixes.ready"] = "fixes.ready"
    count: int

class SsePromptCreated(BaseModel):
    type: Literal["prompt.created"] = "prompt.created"
    version: str

class SseTestDone(BaseModel):
    type: Literal["test.done"] = "test.done"
    results: list[TestResultOut]

class SseRegression(BaseModel):
    type: Literal["regression"] = "regression"
    regression: RegressionOut


SseEvent = (
    SseBatchCreated | SseBatchProgress | SseCallGraded | SseCallUpdated
    | SseRootCausesReady | SseFixesReady | SsePromptCreated
    | SseTestDone | SseRegression
)
