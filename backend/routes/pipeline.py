"""GET /api/pipeline — current pipeline state."""
from fastapi import APIRouter
from schemas import PipelineOut
from services import events as ev

router = APIRouter()


@router.get("/api/pipeline", response_model=PipelineOut)
def get_pipeline():
    return ev.pipeline_state
