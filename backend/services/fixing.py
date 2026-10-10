"""LLM-based fix generation for root causes."""
import json
import logging
import re

from services.llm import chat

log = logging.getLogger(__name__)

_FIX_SYSTEM = """\
You generate precise, actionable fixes to IndiaMART AI voice-bot ("Tanya") prompt deficiencies.

You will be given:
1. Tanya's current operational prompt
2. A root cause — a recurring failure pattern identified from real call analysis
3. Example call snippets showing the failure

Your job: generate ONE targeted fix that addresses the root cause.

OUTPUT — pure JSON, no markdown:
{
  "current_excerpt": "exact verbatim text from the current prompt that needs changing, or empty string if adding a new rule",
  "proposed_change": "the replacement text, or the new guideline to add (2-5 sentences, practical and specific)",
  "rationale": "1-2 sentences: why this change directly reduces this failure",
  "expected_repair_pct": integer 0-100
}

Rules:
- current_excerpt must be an exact quote from the prompt (or "").
- proposed_change must be immediately usable — not vague advice.
- For "ASR Issue" types, focus on disambiguation or clarification prompts the bot can use.
- For "Prompt Issue" types, target the specific instruction that is missing or wrong.
- For "Knowledge Gap" types, add handling for the specific edge case.
- For "Flow Logic" types, fix the sequencing or condition that causes the loop/skip."""


def _format_snippets(snippets: list) -> str:
    lines = []
    for s in snippets[:3]:
        lines.append(f"Call {s.get('call_id', '?')}:")
        for turn in (s.get("lines") or []):
            spk = turn.get("speaker", "?") if isinstance(turn, dict) else turn.speaker
            txt = turn.get("text", "") if isinstance(turn, dict) else turn.text
            lines.append(f"  {spk}: {txt}")
    return "\n".join(lines)


async def generate_fix_for_root_cause(
    root_cause,
    current_prompt: str,
    prompt_version: str,
) -> dict | None:
    """Call LLM to generate a fix for one root cause. Returns dict or None on failure."""
    snippets_text = _format_snippets(root_cause.snippets or [])
    user_msg = f"""TANYA'S CURRENT PROMPT:
{current_prompt}

ROOT CAUSE:
Name: {root_cause.name}
Type: {root_cause.type}
Description: {root_cause.description}
Affected calls: {len(root_cause.call_ids)}

Example failure snippets:
{snippets_text}"""

    try:
        raw = await chat(_FIX_SYSTEM, user_msg, max_tokens=512, timeout=60.0)
        raw = re.sub(r"```(?:json)?\s*", "", raw).strip().rstrip("`").strip()
        data = json.loads(raw)
        expected_pct = min(100, max(0, int(data.get("expected_repair_pct", 70))))
        affected = len(root_cause.call_ids)
        return {
            "root_cause_id": root_cause.id,
            "root_cause_name": root_cause.name,
            "prompt_version": prompt_version,
            "current_excerpt": str(data.get("current_excerpt", ""))[:1000],
            "proposed_change": str(data.get("proposed_change", ""))[:2000],
            "rationale": str(data.get("rationale", ""))[:500],
            "expected_calls_repaired": round(affected * expected_pct / 100),
            "affected_calls": affected,
            "priority_score": root_cause.priority_score,
        }
    except Exception as exc:
        log.error("Fix generation failed for RC %d (%s): %s", root_cause.id, root_cause.name, exc)
        return None
