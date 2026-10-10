"""GET  /api/calls          — list all calls
   GET  /api/calls/:id      — single call detail
   POST /api/calls/:id/review  — toggle reviewed flag
   POST /api/calls/:id/verify  — mark transcript as verified-correct
   POST /api/calls/:id/rerun   — re-transcribe (clears verification + runs Sarvam+LLM)
   POST /api/calls/:id/replay  — placeholder (Phase 2)
"""
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from config import settings
from database import get_db
from models import Call
from schemas import CallOut
from services import events as ev
from services.grading import grade_call
from services.transcription import transcribe, turns_to_dicts

router = APIRouter()


def _serialize(call: Call) -> dict:
    return {
        "id": call.id,
        "call_id": call.call_id,
        "batch_id": call.batch_id,
        "file_name": call.file_name,
        "prompt_version": call.prompt_version,
        "created_at": call.created_at.isoformat(),
        "duration_sec": call.duration_sec,
        "language": call.language,
        "overall_confidence": call.overall_confidence,
        "grade": call.grade,
        "call_outcome": call.call_outcome,
        "category": call.category,
        "reason": call.reason,
        "evidence": call.evidence,
        "evidence_timestamp": call.evidence_timestamp,
        "evidence_turn": call.evidence_turn,
        "risky_flags": call.risky_flags or [],
        "reviewed": call.reviewed,
        "root_cause_id": call.root_cause_id,
        "transcript": call.transcript or [],
        "simulated_transcript": call.simulated_transcript,
        "simulated_grade": call.simulated_grade,
        "verified": call.verified,
        "audio_hash": call.audio_hash,
    }


@router.get("/api/calls", response_model=list[CallOut])
def list_calls(batch_id: int | None = Query(default=None), db: Session = Depends(get_db)):
    q = db.query(Call).order_by(Call.id)
    if batch_id is not None:
        q = q.filter(Call.batch_id == batch_id)
    return q.all()


@router.get("/api/calls/{call_id}", response_model=CallOut)
def get_call(call_id: int, db: Session = Depends(get_db)):
    call = db.get(Call, call_id)
    if not call:
        raise HTTPException(404, f"Call {call_id} not found")
    return call


@router.post("/api/calls/{call_id}/review", response_model=CallOut)
def mark_reviewed(call_id: int, db: Session = Depends(get_db)):
    call = db.get(Call, call_id)
    if not call:
        raise HTTPException(404, f"Call {call_id} not found")
    call.reviewed = not call.reviewed
    db.commit()
    db.refresh(call)
    ev.broadcast("call.updated", {"call": _serialize(call)})
    return call


@router.post("/api/calls/{call_id}/verify", response_model=CallOut)
def verify_call(call_id: int, db: Session = Depends(get_db)):
    """Mark a transcript as verified-correct so re-uploads skip Sarvam."""
    call = db.get(Call, call_id)
    if not call:
        raise HTTPException(404, f"Call {call_id} not found")
    call.verified = True
    db.commit()
    db.refresh(call)
    ev.broadcast("call.updated", {"call": _serialize(call)})
    return call


@router.post("/api/calls/{call_id}/rerun", response_model=CallOut)
def rerun_call(call_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Re-transcribe a call from scratch (clears verification, re-runs Sarvam + LLM)."""
    call = db.get(Call, call_id)
    if not call:
        raise HTTPException(404, f"Call {call_id} not found")

    file_path = str(Path(settings.upload_dir) / call.file_name)
    if not Path(file_path).exists():
        raise HTTPException(422, f"Audio file not found on disk: {call.file_name}")

    # Reset to pending state
    call.verified = False
    call.audio_hash = None
    call.transcript = []
    call.grade = "Non-Fatal"
    call.reason = "Re-transcription in progress…"
    call.evidence = ""
    call.evidence_timestamp = "00:00"
    call.evidence_turn = None
    call.duration_sec = 0
    call.overall_confidence = 0.0
    db.commit()
    db.refresh(call)
    ev.broadcast("call.updated", {"call": _serialize(call)})

    background_tasks.add_task(_do_rerun, call_id, file_path)
    return call


async def _do_rerun(call_id: int, file_path: str) -> None:
    """Background: re-transcribe and update the existing call record."""
    from database import SessionLocal

    file_name = Path(file_path).name
    ev.broadcast("batch.file_progress", {"file": file_name, "step": "transcribing"})

    try:
        result = await transcribe(file_path)
        error_msg = None
    except Exception as exc:
        result = None
        error_msg = str(exc)

    ev.broadcast("batch.file_progress", {"file": file_name, "step": "done"})

    with SessionLocal() as db:
        call = db.get(Call, call_id)
        if not call:
            return

        if result:
            ev.broadcast("batch.file_progress", {"file": file_name, "step": "grading"})
            grading = await grade_call(result.turns, result.overall_confidence)
            turn_dicts = turns_to_dicts(result.turns)
            call.transcript = turn_dicts
            call.duration_sec = result.duration_sec
            call.language = result.language
            call.overall_confidence = result.overall_confidence
            call.audio_hash = result.audio_hash
            call.grade = grading.grade
            call.call_outcome = grading.call_outcome
            call.category = grading.category
            call.reason = grading.reason
            call.evidence = grading.evidence
            call.evidence_timestamp = grading.evidence_timestamp
            call.evidence_turn = grading.evidence_turn
            call.risky_flags = grading.risky_flags
        else:
            call.reason = f"Re-transcription failed: {error_msg}"

        db.commit()
        db.refresh(call)
        ev.broadcast("call.updated", {"call": _serialize(call)})


@router.get("/api/audio/{file_name}")
def serve_audio(file_name: str):
    """Serve an uploaded audio file for in-browser playback.
    Searches the upload dir recursively and also tries the done- prefix fallback.
    """
    safe_name = Path(file_name).name  # prevent path traversal
    upload_root = Path(settings.upload_dir)

    candidates = [safe_name, f"done-{safe_name}"]
    file_path = None
    for name in candidates:
        # Check root first, then subdirectories
        direct = upload_root / name
        if direct.exists():
            file_path = direct
            break
        matches = list(upload_root.rglob(name))
        if matches:
            file_path = matches[0]
            break

    if not file_path:
        raise HTTPException(404, "Audio file not found")

    suffix = file_path.suffix.lower()
    media_type = "audio/mpeg" if suffix == ".mp3" else "audio/wav" if suffix == ".wav" else "audio/ogg"
    return FileResponse(file_path, media_type=media_type)


@router.post("/api/calls/{call_id}/replay")
def replay_call(call_id: int, db: Session = Depends(get_db)):
    """Phase 2 placeholder — returns current transcript unchanged."""
    call = db.get(Call, call_id)
    if not call:
        raise HTTPException(404, f"Call {call_id} not found")
    return {
        "transcript": call.simulated_transcript or call.transcript or [],
        "grade": call.simulated_grade or call.grade,
    }
