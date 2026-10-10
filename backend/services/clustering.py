"""LLM-based root cause clustering for Fatal calls in a batch."""
import json
import logging
import re
from dataclasses import dataclass, field

from config import settings
from services.llm import chat

log = logging.getLogger(__name__)

_CLUSTER_SYSTEM = """\
You analyze Fatal quality failures from IndiaMART AI voice-bot calls and group them into root causes.

CONTEXT
Each call was graded Fatal because the bot ("Tanya") clearly failed its mission: collecting buyer requirements (product, quantity, city/state/pincode) and connecting them with sellers.

ROOT CAUSE TYPES — pick the best fit for each group:
  "Prompt Issue"    — The bot's scripted behavior is wrong: wrong sequence, missing step, wrong phrasing, premature close
  "ASR Issue"       — Speech recognition failures: bot mis-heard or garbled the user's input
  "Knowledge Gap"   — Bot didn't know how to handle an edge case: unusual product, user language, off-script request
  "Flow Logic"      — Bot got stuck, looped, or skipped required steps due to dialog-flow logic errors

TASK
Group the provided Fatal calls into 1–5 root causes. Each root cause is a distinct recurring failure pattern.
- Calls that share the same failure pattern belong in the same root cause.
- If a call is unique and doesn't fit a pattern, give it its own root cause.
- Be specific in the name (10 words max) and description (1–2 sentences explaining the systemic issue).

OUTPUT — pure JSON array, no markdown, no explanation:
[
  {
    "name": "Short descriptive name of the failure pattern",
    "description": "1–2 sentences explaining what goes wrong and why it's a systemic issue.",
    "type": "Prompt Issue" | "ASR Issue" | "Knowledge Gap" | "Flow Logic",
    "call_ids": [list of integer call ids that belong to this root cause]
  },
  ...
]

RULES
- Every call_id from the input MUST appear in exactly one root cause.
- call_ids must be the integer IDs from the input (not the CL-XXXX codes).
- Names must be unique across the list.
- Return only the JSON array."""


def _build_clustering_input(fatal_calls: list) -> str:
    lines = []
    for c in fatal_calls:
        lines.append(
            f"id={c['id']} ({c['call_id']}) | category={c['category']} | "
            f"reason={c['reason']} | evidence=\"{c['evidence']}\""
        )
    return "\n".join(lines)


def _extract_snippets(call, evidence_turn: int | None) -> list:
    """Return a small window of turns around the evidence turn."""
    turns = call.transcript or []
    if evidence_turn is None or not turns:
        return turns[:3]  # first 3 turns as context fallback
    start = max(0, evidence_turn - 1)
    end = min(len(turns), evidence_turn + 2)
    return turns[start:end]


@dataclass
class ClusterResult:
    name: str
    description: str
    type: str
    call_ids: list  # DB ids


_VALID_TYPES = {"Prompt Issue", "ASR Issue", "Knowledge Gap", "Flow Logic"}


async def cluster_fatal_calls(fatal_calls: list, total_in_batch: int) -> list[ClusterResult]:
    """Group fatal_calls into root causes via LLM. Returns list of ClusterResult."""
    if not fatal_calls or not (settings.gemini_api_key or settings.openrouter_api_key or settings.openrouter_api_key_personal or settings.groq_api_key):
        return []

    user_msg = _build_clustering_input(fatal_calls)
    log.info("Clustering %d fatal calls", len(fatal_calls))

    try:
        raw = await chat(_CLUSTER_SYSTEM, user_msg, max_tokens=1024, timeout=60.0)

        log.info("Clustering raw response: %s", raw[:400])
        raw = re.sub(r"```(?:json)?\s*", "", raw).strip().rstrip("`").strip()

        groups = json.loads(raw)
        if not isinstance(groups, list):
            log.warning("Clustering returned non-list; skipping")
            return []

        # Validate all input call_ids are accounted for
        input_ids = {c["id"] for c in fatal_calls}
        covered = set()
        results = []
        for g in groups:
            ids = [i for i in (g.get("call_ids") or []) if isinstance(i, int) and i in input_ids]
            covered.update(ids)
            rc_type = g.get("type", "Prompt Issue")
            if rc_type not in _VALID_TYPES:
                rc_type = "Prompt Issue"
            results.append(ClusterResult(
                name=str(g.get("name", "Unknown"))[:100],
                description=str(g.get("description", ""))[:500],
                type=rc_type,
                call_ids=ids,
            ))

        # Any uncovered calls get a catch-all
        uncovered = input_ids - covered
        if uncovered:
            results.append(ClusterResult(
                name="Uncategorised failures",
                description="Fatal calls that did not match a specific pattern.",
                type="Other",
                call_ids=list(uncovered),
            ))

        log.info("Clustering produced %d root causes", len(results))
        return results

    except Exception as exc:
        log.error("Clustering failed: %s", exc)
        return []
