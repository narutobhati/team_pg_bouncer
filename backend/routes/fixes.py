"""Fix management — approve, reject, preview, apply."""
import asyncio
import difflib
import time
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import SessionLocal, get_db
from models import Call, Fix, PromptVersion, Regression, RootCause, TestResult
from schemas import FixOut, TestResultOut
from services import events as ev
from services.testing import run_test_for_fix

router = APIRouter()


# ── list ──────────────────────────────────────────────────────────────────────

@router.get("/api/fixes", response_model=list[FixOut])
def list_fixes(db: Session = Depends(get_db)):
    return db.query(Fix).order_by(Fix.priority_score.desc(), Fix.created_at.desc()).all()


# ── approve / reject ──────────────────────────────────────────────────────────

class ApproveRequest(BaseModel):
    ids: list[int] = []
    edits: dict[str, str] = {}


@router.post("/api/fixes/approve", response_model=dict)
def approve_and_apply_fixes(
    body: ApproveRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Approve selected fixes (with optional edits), create a new prompt version, and start testing."""
    active_pv = db.query(PromptVersion).filter_by(active=True).first()
    if not active_pv:
        raise HTTPException(400, "No active prompt version")

    fixes = (
        db.query(Fix).filter(Fix.id.in_(body.ids)).all()
        if body.ids
        else db.query(Fix).filter_by(status="Pending Review").all()
    )
    if not fixes:
        raise HTTPException(400, "No fixes to approve")

    # Apply any user edits to proposed_change before creating the new prompt
    for fix in fixes:
        edited = body.edits.get(str(fix.id))
        if edited:
            fix.proposed_change = edited

    new_version = _next_version(active_pv.version)
    new_text = _apply_fixes_to_prompt(active_pv.text, fixes)
    diff = _build_diff(active_pv.text, new_text)

    active_pv.active = False

    new_pv = PromptVersion(
        version=new_version,
        created_at=datetime.utcnow(),
        based_on=active_pv.version,
        fixes_applied=[f.id for f in fixes],
        fixed_root_causes=[f.root_cause_name for f in fixes],
        text=new_text,
        diff=diff,
        calls_applied=0,
        batch_ids=[],
        active=True,
    )
    db.add(new_pv)

    for fix in fixes:
        fix.status = "Approved"
        fix.applied_in = new_version
        rc = db.get(RootCause, fix.root_cause_id)
        if rc:
            rc.fixed = True
            rc.fix_id = fix.id

    db.commit()
    ev.broadcast("prompt.created", {"version": new_version})

    background_tasks.add_task(
        _run_tests_background,
        fixes=[{"id": f.id, "root_cause_id": f.root_cause_id, "proposed_change": f.proposed_change} for f in fixes],
        prompt_before=active_pv.text,
        prompt_after=new_text,
        new_version=new_version,
        started_at=time.time(),
    )

    return {"version": new_version, "fixes_applied": len(fixes)}


@router.post("/api/fixes/{fix_id}/approve")
def approve_fix(fix_id: int, db: Session = Depends(get_db)):
    fix = db.get(Fix, fix_id)
    if not fix:
        raise HTTPException(404, "Fix not found")
    fix.status = "Approved"
    db.commit()
    return {"id": fix.id, "status": fix.status}


@router.post("/api/fixes/{fix_id}/retest")
async def retest_fix(fix_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Re-run the replay test for an existing fix without creating a new prompt version."""
    fix = db.get(Fix, fix_id)
    if not fix:
        raise HTTPException(404, "Fix not found")

    # prompt_before = the version the fix was written against
    pv_before = db.get(PromptVersion, fix.prompt_version)
    prompt_before = pv_before.text if pv_before else ""

    # prompt_after = applied version if it exists, else simulate applying fix
    if fix.applied_in:
        pv_after = db.get(PromptVersion, fix.applied_in)
        prompt_after = pv_after.text if pv_after else _apply_fixes_to_prompt(prompt_before, [fix])
        new_version = fix.applied_in
    else:
        prompt_after = _apply_fixes_to_prompt(prompt_before, [fix])
        active_pv = db.query(PromptVersion).filter_by(active=True).first()
        new_version = active_pv.version if active_pv else fix.prompt_version

    background_tasks.add_task(
        _run_tests_background,
        fixes=[{"id": fix.id, "root_cause_id": fix.root_cause_id, "proposed_change": fix.proposed_change}],
        prompt_before=prompt_before,
        prompt_after=prompt_after,
        new_version=new_version,
        started_at=time.time(),
    )
    return {"status": "testing", "fix_id": fix_id}


@router.post("/api/fixes/{fix_id}/reject")
def reject_fix(fix_id: int, db: Session = Depends(get_db)):
    fix = db.get(Fix, fix_id)
    if not fix:
        raise HTTPException(404, "Fix not found")
    fix.status = "Rejected"
    # Clear the fixed flag on the root cause — a rejected fix means it's not fixed
    rc = db.get(RootCause, fix.root_cause_id)
    if rc:
        rc.fixed = False
    db.commit()
    return {"id": fix.id, "status": fix.status}


# ── preview ───────────────────────────────────────────────────────────────────

class PreviewRequest(BaseModel):
    ids: list[int] = []
    edits: dict[str, str] = {}


@router.post("/api/fixes/preview")
def preview_prompt(body: PreviewRequest, db: Session = Depends(get_db)):
    active_pv = db.query(PromptVersion).filter_by(active=True).first()
    if not active_pv:
        return {"text": "", "diff": []}

    fixes = (
        db.query(Fix).filter(Fix.id.in_(body.ids)).all()
        if body.ids
        else db.query(Fix).filter_by(status="Pending Review").all()
    )

    # Apply user edits on top of LLM-proposed changes for preview
    class _FakeFixWithEdit:
        def __init__(self, fix, override):
            self.current_excerpt = fix.current_excerpt
            self.proposed_change = override or fix.proposed_change

    effective = [_FakeFixWithEdit(f, body.edits.get(str(f.id))) for f in fixes]
    new_text = _apply_fixes_to_prompt(active_pv.text, effective)
    diff = _build_diff(active_pv.text, new_text)
    return {"text": new_text, "diff": diff}




# ── helpers ───────────────────────────────────────────────────────────────────

def _next_version(current: str) -> str:
    try:
        n = int(current.lstrip("v"))
        return f"v{n + 1}"
    except ValueError:
        return "v2"


def _apply_fixes_to_prompt(prompt_text: str, fixes: list) -> str:
    text = prompt_text
    for fix in fixes:
        if fix.current_excerpt and fix.current_excerpt.strip() in text:
            text = text.replace(fix.current_excerpt.strip(), fix.proposed_change.strip(), 1)
        else:
            text = text.rstrip() + "\n- " + fix.proposed_change.strip()
    return text


def _build_diff(before: str, after: str) -> list[dict]:
    a_lines = before.splitlines()
    b_lines = after.splitlines()
    diff = []
    matcher = difflib.SequenceMatcher(None, a_lines, b_lines)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for line in a_lines[i1:i2]:
                diff.append({"kind": "context", "text": line})
        elif tag in ("replace", "delete"):
            for line in a_lines[i1:i2]:
                diff.append({"kind": "remove", "text": line})
            if tag == "replace":
                for line in b_lines[j1:j2]:
                    diff.append({"kind": "add", "text": line})
        elif tag == "insert":
            for line in b_lines[j1:j2]:
                diff.append({"kind": "add", "text": line})
    return diff


async def _run_tests_background(
    fixes: list[dict],
    prompt_before: str,
    prompt_after: str,
    new_version: str,
    started_at: float,
) -> None:
    ev.update_pipeline(stage="testing")
    results = []

    with SessionLocal() as db:
        for fix_data in fixes:
            fix = db.get(Fix, fix_data["id"])
            rc = db.get(RootCause, fix_data["root_cause_id"])
            if not fix or not rc:
                continue

            calls = db.query(Call).filter(Call.id.in_(rc.call_ids or [])).all()
            if not calls:
                continue

            result_data = await run_test_for_fix(
                fix=fix,
                root_cause=rc,
                calls=calls,
                prompt_before=prompt_before,
                prompt_after=prompt_after,
                started_at=started_at,
            )

            # Persist simulated grades
            for rc_call in calls:
                sim_grade = getattr(rc_call, "_sim_grade", None)
                sim_reason = getattr(rc_call, "_sim_reason", None)
                if sim_grade:
                    rc_call.simulated_grade = sim_grade
                    rc_call.simulated_transcript = None

            tr = TestResult(**result_data)
            db.add(tr)
            db.flush()

            # Update fix status based on test verdict
            fix.status = result_data["verdict"]  # "Validated" or "Needs Revision"

            # Only raise a regression if the fix was NOT already validated by a human live test
            if result_data["verdict"] == "Needs Revision" and not fix.human_validated:
                rc.regressed = True
                reg = Regression(
                    root_cause_name=rc.name,
                    fixed_in=new_version,
                    batch_id=rc.batch_id,
                    frequency=rc.frequency,
                    created_at=datetime.utcnow(),
                )
                db.add(reg)
                ev.broadcast("regression", {
                    "regression": {
                        "id": 0,
                        "root_cause_name": rc.name,
                        "fixed_in": new_version,
                        "batch_id": rc.batch_id,
                        "frequency": rc.frequency,
                        "created_at": datetime.utcnow().isoformat(),
                    }
                })

            results.append(result_data)

        # Compute projected_fatal_rate for the new prompt version from test results
        if results:
            total_replayed = sum(r["replayed"] for r in results)
            total_after_fatal = sum(r["after_fatal"] for r in results)
            projected = round(total_after_fatal / total_replayed, 4) if total_replayed else None
            new_pv = db.query(PromptVersion).filter_by(version=new_version).first()
            if new_pv and projected is not None:
                new_pv.projected_fatal_rate = projected

        db.commit()

    ev.update_pipeline(stage="done")

    if results:
        ev.broadcast("test.done", {"results": _format_test_results(results)})


def _format_test_results(results: list[dict]) -> list[dict]:
    out = []
    for r in results:
        out.append({
            "fix_id": r["fix_id"],
            "root_cause_id": r["root_cause_id"],
            "root_cause_name": r["root_cause_name"],
            "prompt_before": r["prompt_before"][:200],
            "prompt_after": r["prompt_after"][:200],
            "replayed": r["replayed"],
            "before_fatal": r["before_fatal"],
            "after_fatal": r["after_fatal"],
            "repaired": r["repaired"],
            "still_failing": r["still_failing"],
            "regressed": r["regressed"],
            "seconds_to_fix": r["seconds_to_fix"],
            "verdict": r["verdict"],
            "completed_at": datetime.utcnow().isoformat(),
        })
    return out
