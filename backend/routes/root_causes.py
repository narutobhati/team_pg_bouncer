"""GET /api/root-causes — list root causes (optionally filtered by batch)."""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database import SessionLocal, get_db
from models import Fix, PromptVersion, RootCause
from schemas import RootCauseOut
from services import events as ev

router = APIRouter()


@router.get("/api/root-causes", response_model=list[RootCauseOut])
def list_root_causes(batch_id: int | None = Query(default=None), db: Session = Depends(get_db)):
    q = db.query(RootCause).order_by(RootCause.priority_score.desc())
    if batch_id is not None:
        q = q.filter(RootCause.batch_id == batch_id)
    return q.all()


@router.post("/api/root-causes/{rc_id}/generate-fix")
async def generate_fix_for_rc(rc_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Manually trigger LLM fix generation for a single root cause."""
    rc = db.get(RootCause, rc_id)
    if not rc:
        raise HTTPException(404, "Root cause not found")

    active_pv = db.query(PromptVersion).filter_by(active=True).first()
    if not active_pv:
        raise HTTPException(400, "No active prompt version")

    existing = db.query(Fix).filter_by(root_cause_id=rc_id).first()
    if existing and existing.status not in ("Rejected",):
        raise HTTPException(409, f"Fix already exists (status: {existing.status}). Reject it first to regenerate.")

    # Remove a rejected fix so we can create a fresh one
    if existing:
        db.delete(existing)
        db.commit()

    background_tasks.add_task(_generate_fix_bg, rc_id, active_pv.text, active_pv.version)
    return {"status": "generating", "rc_id": rc_id}


async def _generate_fix_bg(rc_id: int, prompt_text: str, prompt_version: str) -> None:
    from services.fixing import generate_fix_for_root_cause

    ev.update_pipeline(stage="fixing")
    with SessionLocal() as db:
        rc = db.get(RootCause, rc_id)
        if not rc:
            ev.update_pipeline(stage="done")
            return

        fix_data = await generate_fix_for_root_cause(rc, prompt_text, prompt_version)
        if fix_data:
            db.add(Fix(**fix_data))
            db.commit()
            ev.broadcast("fixes.ready", {"count": 1})

    ev.update_pipeline(stage="done")
