"""Phase 2 stub routes — return empty lists so the frontend loads without errors."""
from fastapi import APIRouter

router = APIRouter()



@router.get("/api/fixes")
def list_fixes():
    return []


@router.post("/api/fixes/approve")
def approve_fixes():
    return {}


@router.post("/api/fixes/{fix_id}/reject")
def reject_fix(fix_id: int):
    return {}


@router.post("/api/fixes/preview")
def preview_prompt():
    return {"text": "", "diff": []}


@router.get("/api/tests")
def list_tests():
    return []


@router.get("/api/tests/{fix_id}/calls")
def list_replayed_calls(fix_id: int):
    return []


@router.get("/api/regressions")
def list_regressions():
    return []
