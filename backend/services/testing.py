"""Replay Fatal calls with an updated prompt and measure improvement."""
import json
import logging
import re
import time

from services.llm import chat
from services.grading import _GRADING_SYSTEM, _format_transcript, _VALID_CATEGORIES, _VALID_FLAGS, _VALID_OUTCOMES

log = logging.getLogger(__name__)


async def _regrade_with_fix(turns: list, proposed_change: str) -> dict:
    """Re-grade a transcript assuming the bot has the proposed fix applied."""
    transcript_text = _format_transcript(turns)
    system = (
        _GRADING_SYSTEM
        + f"\n\n─────────────────────────────────────────────\n"
        f"RE-EVALUATION CONTEXT\n"
        f"─────────────────────────────────────────────\n"
        f"The bot's prompt has been updated with this fix:\n\"{proposed_change}\"\n\n"
        f"Re-evaluate the transcript AS IF the bot had followed this new guideline.\n"
        f"If the fix directly addresses the failure, downgrade to Non-Fatal.\n"
        f"If the failure is caused by something unrelated to the fix, keep Fatal."
    )
    try:
        raw = await chat(system, transcript_text, max_tokens=512, timeout=45.0)
        raw = re.sub(r"```(?:json)?\s*", "", raw).strip().rstrip("`").strip()
        data = json.loads(raw)
        grade = data.get("grade", "Fatal")
        if grade not in ("Fatal", "Non-Fatal"):
            grade = "Fatal"
        return {
            "grade": grade,
            "reason": str(data.get("reason", ""))[:500],
        }
    except Exception as exc:
        log.error("Re-grade failed: %s", exc)
        return {"grade": "Fatal", "reason": "Re-grade error"}


async def run_test_for_fix(
    fix,
    root_cause,
    calls: list,
    prompt_before: str,
    prompt_after: str,
    started_at: float,
) -> dict:
    """Replay Fatal calls for this fix's root cause and return test result data."""
    replayed_calls = []
    repaired = 0
    still_failing = 0

    for call in calls:
        turns = call.transcript or []
        if not turns:
            continue

        result = await _regrade_with_fix(turns, fix.proposed_change)
        after_grade = result["grade"]
        status = "Repaired" if after_grade == "Non-Fatal" else "Still Failing"
        if status == "Repaired":
            repaired += 1
        else:
            still_failing += 1

        replayed_calls.append({
            "call_id": call.id,
            "call_code": call.call_id,
            "before": call.grade,
            "after": after_grade,
            "status": status,
            "old_response": call.reason or "",
            "new_response": result["reason"],
        })

        # Store simulated grade back on call (non-blocking — caller handles DB)
        call._sim_grade = after_grade
        call._sim_reason = result["reason"]

    total = len(replayed_calls)
    before_fatal = total  # all these calls were Fatal
    after_fatal = still_failing
    verdict = "Validated" if repaired > still_failing else "Needs Revision"

    return {
        "fix_id": fix.id,
        "root_cause_id": root_cause.id,
        "root_cause_name": root_cause.name,
        "prompt_before": prompt_before,
        "prompt_after": prompt_after,
        "replayed": total,
        "before_fatal": before_fatal,
        "after_fatal": after_fatal,
        "repaired": repaired,
        "still_failing": still_failing,
        "regressed": 0,
        "seconds_to_fix": int(time.time() - started_at),
        "verdict": verdict,
        "replayed_calls": replayed_calls,
    }
