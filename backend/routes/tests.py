"""Test results and regression routes."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from models import Regression, TestResult
from schemas import RegressionOut, TestResultOut

router = APIRouter()


@router.get("/api/tests", response_model=list[TestResultOut])
def list_tests(db: Session = Depends(get_db)):
    results = db.query(TestResult).order_by(TestResult.completed_at.desc()).all()
    return [_to_out(r) for r in results]


@router.get("/api/tests/{fix_id}/calls")
def list_replayed_calls(fix_id: int, db: Session = Depends(get_db)):
    tr = db.query(TestResult).filter_by(fix_id=fix_id).first()
    if not tr:
        return []
    return tr.replayed_calls or []


@router.get("/api/regressions", response_model=list[RegressionOut])
def list_regressions(db: Session = Depends(get_db)):
    return db.query(Regression).order_by(Regression.created_at.desc()).all()


def _to_out(r: TestResult) -> dict:
    return {
        "fix_id": r.fix_id,
        "root_cause_id": r.root_cause_id,
        "root_cause_name": r.root_cause_name,
        "prompt_before": r.prompt_before,
        "prompt_after": r.prompt_after,
        "replayed": r.replayed,
        "before_fatal": r.before_fatal,
        "after_fatal": r.after_fatal,
        "repaired": r.repaired,
        "still_failing": r.still_failing,
        "regressed": r.regressed,
        "seconds_to_fix": r.seconds_to_fix,
        "verdict": r.verdict,
        "completed_at": r.completed_at.isoformat(),
    }
