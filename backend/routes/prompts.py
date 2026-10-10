"""GET /api/prompts — list all prompt versions."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from models import PromptVersion, Call
from schemas import PromptVersionOut

router = APIRouter()


@router.get("/api/prompts", response_model=list[PromptVersionOut])
def list_prompts(db: Session = Depends(get_db)):
    versions = db.query(PromptVersion).order_by(PromptVersion.created_at.desc()).all()
    result = []
    for pv in versions:
        calls = db.query(Call).filter_by(prompt_version=pv.version).all()
        fatal = sum(1 for c in calls if c.grade == "Fatal")
        batches_used = list({c.batch_id for c in calls})
        result.append({
            "version": pv.version,
            "created_at": pv.created_at.isoformat(),
            "based_on": pv.based_on,
            "fixes_applied": pv.fixes_applied or [],
            "fixed_root_causes": pv.fixed_root_causes or [],
            "text": pv.text,
            "diff": pv.diff or [],
            "fatal_rate": round(fatal / len(calls), 2) if calls else None,
            "projected_fatal_rate": pv.projected_fatal_rate,
            "calls_applied": len(calls),
            "batch_ids": batches_used,
            "active": pv.active,
        })
    return result
