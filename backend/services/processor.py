"""Background batch processor — Phase 1: transcription only."""
import asyncio
from datetime import datetime
from pathlib import Path

from sqlalchemy import select

from database import SessionLocal
from models import Batch, Call
from services import events as ev
from services.clustering import cluster_fatal_calls, _extract_snippets
from services.grading import grade_call, GradingResult
from services.transcription import transcribe, turns_to_dicts


async def process_batch(batch_id: int, file_paths: list[str]) -> None:
    """Entry point — runs in the background after upload."""
    ev.update_pipeline(
        stage="processing",
        batch_id=batch_id,
        processed=0,
        total=len(file_paths),
    )

    for file_path in file_paths:
        await _process_one(batch_id, file_path)

    await asyncio.to_thread(_mark_batch_done, batch_id)
    ev.update_pipeline(stage="done", batch_id=batch_id)

    # Trigger clustering for fatal calls in this batch
    await _run_clustering(batch_id)


def _find_existing_by_filename(file_name: str) -> "Call | None":
    """Return the most recent call for this filename that has a transcript."""
    with SessionLocal() as db:
        return db.execute(
            select(Call)
            .where(Call.file_name == file_name, Call.transcript != None)
            .order_by(Call.id.desc())
        ).scalar_one_or_none()


async def _process_one(batch_id: int, file_path: str) -> None:
    file_name = Path(file_path).name

    # Filename is already a unique IndiaMART audio ID — reuse any existing transcript
    existing = await asyncio.to_thread(_find_existing_by_filename, file_name)
    if existing and existing.transcript:
        await asyncio.to_thread(_clone_existing, batch_id, file_name, existing)
        return

    ev.broadcast("batch.file_progress", {"file": file_name, "step": "transcribing"})
    grading: GradingResult | None = None
    try:
        result = await transcribe(file_path)
        ev.broadcast("batch.file_progress", {"file": file_name, "step": "grading"})
        grading = await grade_call(result.turns, result.overall_confidence)
        ev.broadcast("batch.file_progress", {"file": file_name, "step": "done"})
    except Exception as exc:
        result = None
        error_msg = str(exc)
        ev.broadcast("batch.file_progress", {"file": file_name, "step": "done"})

    call_dict, pipeline_dict = await asyncio.to_thread(
        _save_call, batch_id, file_name, result, grading, error_msg if not result else None
    )
    if call_dict:
        ev.pipeline_state.update(processed=pipeline_dict["processed"])
        ev.broadcast("call.graded", {"call": call_dict})
        ev.broadcast("batch.progress", {"pipeline": pipeline_dict})


def _mark_batch_done(batch_id: int) -> None:
    with SessionLocal() as db:
        batch = db.get(Batch, batch_id)
        if batch:
            batch.stage = "done"
            batch.completed_at = datetime.utcnow()
            db.commit()


def _save_call(batch_id: int, file_name: str, result, grading, error_msg: str | None):
    """Sync DB write for one processed call. Returns (call_dict, pipeline_dict) or (None, None)."""
    with SessionLocal() as db:
        batch = db.get(Batch, batch_id)
        if not batch:
            return None, None

        seq = batch.processed + 1
        call_id_str = f"CL-{1000 + seq}"

        if result:
            # Check by audio_hash if a verified transcript exists
            if result.audio_hash:
                existing = db.execute(
                    select(Call).where(Call.audio_hash == result.audio_hash, Call.verified == True)
                ).scalar_one_or_none()
                if existing:
                    call = Call(
                        call_id=call_id_str,
                        batch_id=batch_id,
                        file_name=file_name,
                        prompt_version=batch.prompt_version,
                        duration_sec=existing.duration_sec,
                        language=existing.language,
                        overall_confidence=existing.overall_confidence,
                        grade=existing.grade,
                        category=existing.category,
                        reason=existing.reason,
                        evidence=existing.evidence,
                        evidence_timestamp=existing.evidence_timestamp,
                        evidence_turn=existing.evidence_turn,
                        risky_flags=existing.risky_flags or [],
                        transcript=existing.transcript,
                        audio_hash=result.audio_hash,
                        verified=True,
                    )
                    db.add(call)
                    batch.processed = seq
                    db.commit()
                    db.refresh(call)
                    db.refresh(batch)
                    return _call_to_dict(call), {
                        "stage": "processing", "batch_id": batch_id,
                        "processed": batch.processed, "total": batch.total,
                        "active_prompt": batch.prompt_version,
                    }

            turn_dicts = turns_to_dicts(result.turns)
            g = grading
            call = Call(
                call_id=call_id_str,
                batch_id=batch_id,
                file_name=file_name,
                prompt_version=batch.prompt_version,
                duration_sec=result.duration_sec,
                language=result.language,
                overall_confidence=result.overall_confidence,
                grade=g.grade if g else "Non-Fatal",
                call_outcome=g.call_outcome if g else "completed",
                category=g.category if g else None,
                reason=g.reason if g else "Pending grading",
                evidence=g.evidence if g else "",
                evidence_timestamp=g.evidence_timestamp if g else "00:00",
                evidence_turn=g.evidence_turn if g else None,
                risky_flags=g.risky_flags if g else [],
                transcript=turn_dicts,
                audio_hash=result.audio_hash,
            )
        else:
            call = Call(
                call_id=call_id_str,
                batch_id=batch_id,
                file_name=file_name,
                prompt_version=batch.prompt_version,
                grade="Non-Fatal",
                reason=f"Transcription failed: {error_msg}",
                evidence="",
                evidence_timestamp="00:00",
                risky_flags=[],
                transcript=[],
            )

        db.add(call)
        batch.processed = seq
        db.commit()
        db.refresh(call)
        db.refresh(batch)
        return _call_to_dict(call), {
            "stage": "processing",
            "batch_id": batch_id,
            "processed": batch.processed,
            "total": batch.total,
            "active_prompt": batch.prompt_version,
        }


def _find_verified(file_name: str) -> "Call | None":
    """Check if a verified transcript exists by filename (before Sarvam call)."""
    with SessionLocal() as db:
        return db.execute(
            select(Call).where(Call.file_name == file_name, Call.verified == True)
        ).scalar_one_or_none()


def _clone_existing(batch_id: int, file_name: str, source: "Call") -> None:
    """Reuse a previously transcribed call without hitting Sarvam again."""
    with SessionLocal() as db:
        batch = db.get(Batch, batch_id)
        if not batch:
            return
        seq = batch.processed + 1
        call = Call(
            call_id=f"CL-{1000 + seq}",
            batch_id=batch_id,
            file_name=file_name,
            prompt_version=batch.prompt_version,
            duration_sec=source.duration_sec,
            language=source.language,
            overall_confidence=source.overall_confidence,
            grade=source.grade,
            call_outcome=source.call_outcome,
            category=source.category,
            reason=source.reason,
            evidence=source.evidence,
            evidence_timestamp=source.evidence_timestamp,
            evidence_turn=source.evidence_turn,
            risky_flags=source.risky_flags or [],
            transcript=source.transcript,
            audio_hash=source.audio_hash,
            verified=source.verified,
        )
        db.add(call)
        batch.processed = seq
        db.commit()
        db.refresh(call)
        db.refresh(batch)
        ev.pipeline_state.update(processed=batch.processed)
        ev.broadcast("call.graded", {"call": _call_to_dict(call)})
        ev.broadcast("batch.progress", {"pipeline": {
            "stage": "processing", "batch_id": batch_id,
            "processed": batch.processed, "total": batch.total,
            "active_prompt": batch.prompt_version,
        }})


def _clone_verified(batch_id: int, file_name: str, source: "Call") -> None:
    """Copy a verified transcript into the new batch without re-transcribing."""
    with SessionLocal() as db:
        batch = db.get(Batch, batch_id)
        if not batch:
            return
        seq = batch.processed + 1
        call = Call(
            call_id=f"CL-{1000 + seq}",
            batch_id=batch_id,
            file_name=file_name,
            prompt_version=batch.prompt_version,
            duration_sec=source.duration_sec,
            language=source.language,
            overall_confidence=source.overall_confidence,
            grade=source.grade,
            reason=source.reason,
            evidence=source.evidence,
            evidence_timestamp=source.evidence_timestamp,
            risky_flags=source.risky_flags or [],
            transcript=source.transcript,
            audio_hash=source.audio_hash,
            verified=True,
        )
        db.add(call)
        batch.processed = seq
        db.commit()
        db.refresh(call)
        db.refresh(batch)
        ev.pipeline_state.update(processed=batch.processed)
        ev.broadcast("call.graded", {"call": _call_to_dict(call)})
        ev.broadcast("batch.progress", {"pipeline": {
            "stage": "processing", "batch_id": batch_id,
            "processed": batch.processed, "total": batch.total,
            "active_prompt": batch.prompt_version,
        }})


async def _run_clustering(batch_id: int) -> None:
    """Cluster Fatal calls in a batch into root causes and persist them."""
    from models import RootCause

    # Load fatal calls for this batch
    fatal_summaries, total, call_map = await asyncio.to_thread(_load_fatal_calls, batch_id)
    if not fatal_summaries:
        return

    ev.update_pipeline(stage="clustering", batch_id=batch_id)

    clusters = await cluster_fatal_calls(fatal_summaries, total)
    if not clusters:
        ev.update_pipeline(stage="done", batch_id=batch_id)
        return

    # Persist root causes and update call.root_cause_id
    rc_count = await asyncio.to_thread(_save_root_causes, batch_id, clusters, total, call_map)

    ev.broadcast("root_causes.ready", {"batch_id": batch_id, "count": rc_count})

    # Auto-generate fixes for the new root causes
    await _run_fix_generation(batch_id)


async def _run_fix_generation(batch_id: int) -> None:
    """Generate LLM fixes for all root causes in a batch."""
    from models import Fix, PromptVersion, RootCause as RootCauseModel
    from services.fixing import generate_fix_for_root_cause

    ev.update_pipeline(stage="fixing", batch_id=batch_id)

    with SessionLocal() as db:
        rcs = db.query(RootCauseModel).filter_by(batch_id=batch_id).all()
        active_pv = db.query(PromptVersion).filter_by(active=True).first()
        if not rcs or not active_pv:
            ev.update_pipeline(stage="done", batch_id=batch_id)
            return
        prompt_text = active_pv.text
        prompt_version = active_pv.version

    fix_count = 0
    for rc in rcs:
        fix_data = await generate_fix_for_root_cause(rc, prompt_text, prompt_version)
        if fix_data:
            with SessionLocal() as db:
                # Skip if fix already exists for this root cause
                existing = db.query(Fix).filter_by(root_cause_id=rc.id).first()
                if not existing:
                    db.add(Fix(**fix_data))
                    db.commit()
                    fix_count += 1

    ev.update_pipeline(stage="done", batch_id=batch_id)
    ev.broadcast("fixes.ready", {"count": fix_count})


def _load_fatal_calls(batch_id: int):
    """Return (fatal_summaries, total_calls, call_map) — runs in thread."""
    with SessionLocal() as db:
        from models import Call as CallModel
        all_calls = db.query(CallModel).filter_by(batch_id=batch_id).all()
        total = len(all_calls)
        fatal = [c for c in all_calls if c.grade == "Fatal"]
        summaries = [
            {
                "id": c.id,
                "call_id": c.call_id,
                "category": c.category or "other",
                "reason": c.reason,
                "evidence": c.evidence or "",
                "evidence_turn": c.evidence_turn,
                "transcript": c.transcript or [],
            }
            for c in fatal
        ]
        # call_map: id → full call object data we need for snippets
        call_map = {c.id: c for c in fatal}
        return summaries, total, call_map


def _save_root_causes(batch_id: int, clusters, total: int, call_map: dict) -> int:
    """Persist RootCause rows and update call.root_cause_id. Returns count saved."""
    from models import RootCause, Call as CallModel
    with SessionLocal() as db:
        # Delete any existing root causes for this batch (re-clustering)
        db.query(RootCause).filter_by(batch_id=batch_id).delete()

        count = 0
        for cluster in clusters:
            if not cluster.call_ids:
                continue
            affected = len(cluster.call_ids)
            frequency = round(affected / total, 4) if total else 0.0
            # All calls in the cluster are Fatal, so severity = 1.0
            priority = min(100, round(frequency * 100))

            # Build snippets: evidence_turn ± 1 turns for each call
            snippets = []
            for cid in cluster.call_ids:
                src = call_map.get(cid)
                if src:
                    turns = src.transcript or []
                    ev_turn = src.evidence_turn
                    start = max(0, (ev_turn or 0) - 1)
                    end = min(len(turns), (ev_turn or 0) + 2)
                    window = turns[start:end] if ev_turn is not None else turns[:3]
                    snippets.append({"call_id": cid, "lines": window})

            rc = RootCause(
                batch_id=batch_id,
                name=cluster.name,
                description=cluster.description,
                type=cluster.type,
                call_ids=cluster.call_ids,
                frequency=frequency,
                severity=1.0,
                priority_score=priority,
                fixed=False,
                snippets=snippets,
            )
            db.add(rc)
            db.flush()  # get rc.id

            # Tag each affected call with this root_cause_id
            for cid in cluster.call_ids:
                call = db.get(CallModel, cid)
                if call:
                    call.root_cause_id = rc.id

            count += 1

        # Update batch.clustered_at
        from models import Batch
        batch = db.get(Batch, batch_id)
        from datetime import datetime
        if batch:
            batch.clustered_at = datetime.utcnow()

        db.commit()
        return count


def _call_to_dict(call: Call) -> dict:
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
