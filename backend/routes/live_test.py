"""Live test — interactive bot conversation using the fixed prompt."""
import base64
import logging
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session
import httpx

from database import get_db
from models import Call, Fix, PromptVersion, RootCause
from services import conversation as conv
from services.tts import text_to_speech
from services.grading import grade_call

log = logging.getLogger(__name__)
router = APIRouter()


class StartRequest(BaseModel):
    fix_id: int
    call_id: int | None = None


class TurnRequest(BaseModel):
    text: str


def _build_prompt_with_fix(fix: Fix, base_text: str) -> str:
    """Apply fix to prompt text in-memory (for fixes not yet applied to a version)."""
    if fix.current_excerpt and fix.current_excerpt.strip() in base_text:
        return base_text.replace(fix.current_excerpt.strip(), fix.proposed_change.strip(), 1)
    return base_text.rstrip() + "\n- " + fix.proposed_change.strip()


async def _tts_b64(text: str) -> str | None:
    audio = await text_to_speech(text)
    return base64.b64encode(audio).decode() if audio else None


@router.post("/api/live-test/start")
async def start_live_test(body: StartRequest, db: Session = Depends(get_db)):
    fix = db.get(Fix, body.fix_id)
    if not fix:
        raise HTTPException(404, "Fix not found")

    rc = db.get(RootCause, fix.root_cause_id)

    # Resolve prompt: if fix already applied, use that version; else apply in-memory
    if fix.applied_in:
        pv = db.query(PromptVersion).filter_by(version=fix.applied_in).first()
        prompt_text = pv.text if pv else ""
    else:
        base_pv = db.query(PromptVersion).filter_by(version=fix.prompt_version).first()
        base_text = base_pv.text if base_pv else ""
        prompt_text = _build_prompt_with_fix(fix, base_text)

    rc_name = rc.name if rc else fix.root_cause_name

    # Extract Tanya's opening lines from the original call — used to seed the bot's opener
    buyer_requirement = ""
    ref_call_id = body.call_id if body.call_id and body.call_id in (rc.call_ids if rc else []) else (rc.call_ids[0] if rc and rc.call_ids else None)
    if ref_call_id:
        first_call = db.query(Call).filter(Call.id == ref_call_id).first()
        if first_call and first_call.transcript:
            bot_lines = [
                t["text"].strip()
                for t in first_call.transcript
                if t.get("speaker") == "BOT" and len(t.get("text", "").strip()) > 10
            ]
            # First 2 BOT lines — Tanya's natural opener from the original call
            buyer_requirement = " ".join(bot_lines[:2])

    result = await conv.start_session(body.fix_id, prompt_text, rc_name, buyer_requirement)

    return {
        **result,
        "audio_b64": await _tts_b64(result["opening"]),
        "prompt_version": fix.applied_in or f"{fix.prompt_version}+fix",
        "root_cause_name": rc_name,
        "proposed_change": fix.proposed_change,
    }


@router.post("/api/live-test/{session_id}/turn")
async def send_turn(session_id: str, body: TurnRequest):
    session = conv.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    if session["ended"]:
        raise HTTPException(400, "Session already ended")

    try:
        bot_text = await conv.send_turn(session_id, body.text)
    except ValueError as e:
        raise HTTPException(400, str(e))

    return {
        "text": bot_text,
        "audio_b64": await _tts_b64(bot_text),
    }


@router.post("/api/live-test/{session_id}/stt")
async def live_stt(session_id: str, audio: UploadFile = File(...)):
    """Transcribe one voice turn using Sarvam synchronous STT (fast, not batch)."""
    from config import settings
    if not settings.sarvam_api_key:
        raise HTTPException(503, "Sarvam API key not configured")

    content = await audio.read()
    if not content:
        return {"text": ""}

    filename = audio.filename or "turn.webm"
    content_type = audio.content_type or "audio/webm"

    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(
            "https://api.sarvam.ai/speech-to-text",
            headers={"api-subscription-key": settings.sarvam_api_key},
            files={"file": (filename, content, content_type)},
            data={"model": "saaras:v3", "language_code": "unknown", "with_timestamps": "false"},
        )
        if not resp.is_success:
            log.warning("Sarvam STT error %s: %s", resp.status_code, resp.text)
            return {"text": ""}
        data = resp.json()

    return {"text": (data.get("transcript") or "").strip()}


@router.post("/api/live-test/{session_id}/end")
async def end_live_test(session_id: str, db: Session = Depends(get_db)):
    session = conv.get_session(session_id)
    fix_id = session["fix_id"] if session else None

    turns = conv.end_session(session_id)
    if not turns:
        raise HTTPException(404, "Session not found or no turns")

    grading = await grade_call(turns)

    # Mark the fix as human-validated so the automated replay test won't raise a regression
    if fix_id:
        fix = db.get(Fix, fix_id)
        if fix:
            fix.human_validated = True
            db.commit()

    return {
        "turns": turns,
        "grade": grading.grade,
        "call_outcome": grading.call_outcome,
        "category": grading.category,
        "reason": grading.reason,
        "evidence": grading.evidence,
        "risky_flags": grading.risky_flags,
    }
