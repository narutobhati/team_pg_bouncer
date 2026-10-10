"""POST /api/batches  — upload files + create batch
   GET  /api/batches  — list all batches
"""
import asyncio
import os
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from config import settings
from database import get_db
from models import Batch, PromptVersion
from schemas import BatchOut
from services import events as ev
from services.processor import process_batch

router = APIRouter()


@router.get("/api/batches", response_model=list[BatchOut])
def list_batches(db: Session = Depends(get_db)):
    return db.query(Batch).order_by(Batch.id).all()


@router.post("/api/batches", response_model=BatchOut, status_code=201)
async def create_batch(
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    label: str = Form(""),
    db: Session = Depends(get_db),
):
    # Reject if pipeline is busy
    if ev.pipeline_state["stage"] in ("processing", "clustering", "fixing", "testing"):
        raise HTTPException(409, "Pipeline is busy — wait for current batch to finish.")

    if not files:
        raise HTTPException(400, "No audio files provided.")

    # Get active prompt version
    active_prompt = db.query(PromptVersion).filter_by(active=True).first()
    prompt_ver = active_prompt.version if active_prompt else "v1"

    # Save uploaded files to disk
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)

    MAX_FILES = 15
    saved_paths: list[str] = []
    for upload in files:
        if not _is_audio(upload.filename or ""):
            continue
        if len(saved_paths) >= MAX_FILES:
            break
        dest = upload_dir / upload.filename
        content = await upload.read()
        dest.write_bytes(content)
        saved_paths.append(str(dest))

    if not saved_paths:
        raise HTTPException(400, "No valid audio files found (accepted: mp3, wav, m4a, ogg, flac).")

    # Create batch record
    batch_label = label.strip() or f"Batch {datetime.utcnow().strftime('%Y-%m-%d %H:%M')}"
    batch = Batch(
        label=batch_label,
        total=len(saved_paths),
        processed=0,
        prompt_version=prompt_ver,
        stage="queued",
        created_at=datetime.utcnow(),
    )
    db.add(batch)
    db.commit()
    db.refresh(batch)

    # Broadcast batch.created SSE
    ev.broadcast("batch.created", {
        "batch": {
            "id": batch.id,
            "label": batch.label,
            "total": batch.total,
            "processed": batch.processed,
            "prompt_version": batch.prompt_version,
            "stage": batch.stage,
            "created_at": batch.created_at.isoformat(),
        }
    })

    # Update pipeline state immediately
    ev.pipeline_state.update(
        stage="queued",
        batch_id=batch.id,
        processed=0,
        total=batch.total,
        active_prompt=prompt_ver,
    )

    # Process in background
    background_tasks.add_task(_run, batch.id, saved_paths)

    return batch


def _is_audio(filename: str) -> bool:
    return Path(filename).suffix.lower() in {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac"}


async def _run(batch_id: int, file_paths: list[str]):
    await process_batch(batch_id, file_paths)
