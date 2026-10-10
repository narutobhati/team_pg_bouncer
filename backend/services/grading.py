"""LLM-based call grading — Fatal vs Non-Fatal with evidence and risky flags."""
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Optional

from config import settings
from services.llm import chat

log = logging.getLogger(__name__)

_GRADING_SYSTEM = """\
You grade IndiaMART AI voice-bot calls for quality issues.

CONTEXT
"Tanya" is IndiaMART's AI voice assistant (female, scripted). She calls buyers who posted a product requirement on the IndiaMART B2B marketplace.
Her job on each call:
  1. Confirm the buyer still needs the product.
  2. Collect key details: quantity and specifications. Location (city/state/pincode) is helpful but NOT mandatory — IndiaMART already has the buyer's registered location from their profile, so the call can succeed without it.
  3. Tell the buyer that relevant sellers will contact them, then close politely.

IMPORTANT — what the bot's job really is:
  The bot's primary role is HUMAN-LIKE ENGAGEMENT, not mechanical data collection.
  A buyer who feels heard and understood is a successful call even if location was not verbally confirmed.
  Tanya should respond to what the buyer is actually saying — their emotions, concerns, and real-time questions — not just check off a script.

If the buyer does NOT want to continue (not interested, already bought, wrong person, busy), the correct behaviour is:
  acknowledge → at most ONE gentle retention/confirmation attempt → polite close.
  Pushing on after a clear refusal is a bot failure. The buyer declining is NOT a bot failure.

If the buyer asks for photos, videos, or product samples:
  Correct response: acknowledge the request empathetically, explain sellers will share photos/samples directly, then continue naturally.
  NOT acceptable: ignoring the request and redirecting to the script without acknowledgment.

If the buyer does not share location / avoids the location question:
  This is NOT a bot failure. Location can be retrieved from the buyer's IndiaMART profile.
  The bot should ask once, and if the buyer doesn't answer or deflects, gracefully move on and close.
  Do NOT grade Fatal just because location was not captured verbally.

Calls are in Hindi/English code-mix. ASR transcripts have spelling noise, merged turns, garbled words, and occasional speaker mislabels. Do not blame the bot for something that is plausibly an ASR or labeling artefact.

─────────────────────────────────────────────
STEP 1 — Determine call_outcome
─────────────────────────────────────────────
Read the full call and assign exactly ONE outcome:

  completed          — Buyer engaged, requirement confirmed, bot closed politely. Location may or may not have been captured verbally.
  not_interested     — Buyer clearly said they don't need the service, are not interested, or want to end the call.
  already_fulfilled  — Buyer already purchased / found a supplier / requirement is met.
  wrong_person       — Call reached the wrong person (not the buyer who posted).
  callback_requested — Buyer asked to be called back later and bot closed.
  user_dropped       — Call ended abruptly (network drop, user hung up mid-conversation without a clear reason).
  bot_failed         — Bot behaved in a clearly broken, robotic, or harmful way that made the call fail (use only when no other outcome fits).

─────────────────────────────────────────────
STEP 2 — Fatal failure check
─────────────────────────────────────────────
Grade FATAL only when there is concrete transcript evidence of ONE of these:

  wrong_capture   — Bot stated wrong information AND persisted with it after the user corrected it.
    FATAL only when: bot repeated or acted on the wrong value AFTER the user explicitly corrected it.
    NOT fatal when: bot made an initial error but accepted the user's correction ("ठीक है", "समझ गई", "okay") and proceeded correctly.
    Examples of Fatal: user said "Jaipur", bot echoed "Kanpur", user corrected, bot still wrote "Kanpur" to the seller.
    Examples of NOT Fatal (use risky flag only): bot said "30A", user said "32A", bot said "ठीक है समझ गई" and closed correctly.

  loop            — Bot asked the same question 3 or more times without the user refusing to answer.
    Examples: bot asked pincode 4 times; bot re-read the same script block.
    NOTE: asking for location once and then moving on gracefully when the buyer doesn't answer is NOT a loop.

  wrong_info      — Bot stated something factually incorrect or outside its script.
    Examples: bot promised "delivery in 2 days", gave a price quote, named a specific seller.

  incomplete      — Bot ended the call WITHOUT confirming even the product type, AND the failure was caused by the bot's own bad behaviour (wrong questions, ignoring user, scripted loop).
    IMPORTANT: Missing location alone is NOT incomplete — location comes from the buyer's IndiaMART profile.
    NOT incomplete when: buyer dropped, wasn't interested, or simply didn't share location.
    IS incomplete when: bot got confused, asked irrelevant questions, and never confirmed what the buyer actually needs.

  ignored_refusal — Bot kept pushing after the buyer clearly declined or said they were not interested.
    Examples: buyer said "nahi chahiye" / "already le liya" / "wrong number" but bot continued its pitch.
    This is Fatal only when the bot pushed MORE THAN ONCE after the refusal.

  empathy_failure — Bot completely ignored the buyer's real-time concern or emotion and robotically continued its script.
    Examples: buyer asked for a product photo multiple times and bot kept redirecting to quantity without ever acknowledging the request; buyer expressed frustration and bot ignored it entirely; buyer asked an off-script question and bot repeated the same scripted line verbatim.
    Grade Fatal only when the empathy failure clearly caused the buyer to disengage or the call to break down.

  compliance      — Bot made unauthorized commitments or said something legally/policy risky.
    Examples: "हम guarantee करते हैं", "आपको refund मिलेगा", "यह product best quality का है".

  other           — Any other clearly catastrophic failure not covered above.

─────────────────────────────────────────────
STEP 3 — Non-Fatal fallback
─────────────────────────────────────────────
If none of the Fatal conditions apply, grade Non-Fatal.
  - call_outcome not_interested / already_fulfilled / wrong_person / callback_requested → almost always Non-Fatal (bot handled correctly).
  - Location not captured verbally → NOT Fatal on its own.
  - Short calls are fine if the goal was achieved.
  - Minor hesitations, a single repeated question, or brief user confusion do not make a call Fatal.

─────────────────────────────────────────────
STEP 4 — Risky flags  (detect all that apply; can be present on Non-Fatal calls)
─────────────────────────────────────────────
  frustration       — User expressed frustration: "nahi nahi", "galat hai", "baar baar", "pareshan", "tang aayi", angry tone words.
  loop              — Bot asked the same question 3+ times (set even if grade=Non-Fatal because it was eventually resolved).
  human_request     — User asked to speak to a human: "insaan se baat karo", "agent chahiye", "supervisor", "manager".
  low_confidence    — Transcript has many very short/garbled turns suggesting bad ASR. Do NOT set for normal short acks ("हाँ", "okay").
  wrong_capture     — Bot stated back something that contradicts what the user said. Set even if the bot later accepted the correction — the initial error is still a signal worth flagging.
  not_interested    — Buyer expressed disinterest or asked to be removed (softer signal; set even if bot handled correctly).
  pushy             — Bot made more than one attempt to retain/pitch after the buyer declined.
  ignored_concern   — Buyer raised a real-time question or concern (photo request, product confusion, off-script topic, timing question) and bot dismissed or ignored it without acknowledgment.
    ALSO set when: the bot said goodbye/closed the call but the buyer's LAST turn is still a question or a continuation signal ("bata", "haan bolo", "kitne baje", "kab milenge", etc.) — premature termination while the buyer is still engaged is always ignored_concern.

─────────────────────────────────────────────
INPUT FORMAT
─────────────────────────────────────────────
Numbered turns:  INDEX [mm:ss] SPEAKER: text
SPEAKER is BOT or USER.

─────────────────────────────────────────────
OUTPUT  — pure JSON, no markdown, no explanation
─────────────────────────────────────────────
{
  "call_outcome": "completed"|"not_interested"|"already_fulfilled"|"wrong_person"|"callback_requested"|"user_dropped"|"bot_failed",
  "grade": "Fatal" or "Non-Fatal",
  "category": null or one of "wrong_capture","loop","wrong_info","incomplete","ignored_refusal","empathy_failure","compliance","other",
  "reason": "1–2 sentence verdict. Be specific: name what succeeded or what failed.",
  "evidence": "Short verbatim quote (≤40 words) from the transcript that best supports the verdict. Empty string for clean Non-Fatal calls.",
  "evidence_timestamp": "mm:ss matching the evidence quote, or 00:00 if no evidence",
  "evidence_turn": null or integer index of the evidence turn,
  "risky_flags": ["flag1", ...]
}

CONSISTENCY RULES
- grade="Non-Fatal" ⇒ category=null
- grade="Fatal" ⇒ category non-null AND evidence non-empty
- category="incomplete" ⇔ call_outcome="bot_failed"
- category="ignored_refusal" ⇒ call_outcome is one of not_interested/already_fulfilled/wrong_person/callback_requested
- Set grade=Fatal ONLY when you can cite a specific transcript quote as evidence.
- Err toward Non-Fatal when unsure. Risky flags can capture softer concerns.
- evidence must be a verbatim excerpt from the transcript (not a paraphrase)."""


@dataclass
class GradingResult:
    grade: str = "Non-Fatal"
    call_outcome: str = "completed"
    category: Optional[str] = None
    reason: str = "Call completed successfully"
    evidence: str = ""
    evidence_timestamp: str = "00:00"
    evidence_turn: Optional[int] = None
    risky_flags: list = field(default_factory=list)


def _format_transcript(turns: list) -> str:
    """Format turns for grading LLM input."""
    lines = []
    for i, t in enumerate(turns):
        ts = t.timestamp if hasattr(t, "timestamp") else t.get("timestamp", "00:00")
        speaker = t.speaker if hasattr(t, "speaker") else t.get("speaker", "BOT")
        text = t.text if hasattr(t, "text") else t.get("text", "")
        lines.append(f"{i} [{ts}] {speaker}: {text}")
    return "\n".join(lines)


_VALID_CATEGORIES = {"wrong_capture", "loop", "wrong_info", "incomplete", "ignored_refusal", "empathy_failure", "compliance", "other"}
_VALID_FLAGS = {"frustration", "loop", "human_request", "low_confidence", "wrong_capture", "not_interested", "pushy", "ignored_concern"}
_VALID_OUTCOMES = {"completed", "not_interested", "already_fulfilled", "wrong_person", "callback_requested", "user_dropped", "bot_failed"}


_QUESTION_SIGNALS = {"?", "kitne", "kab", "kya", "kaise", "kaun", "kahan", "kyun", "bata", "bolo", "when", "how", "what", "who", "where", "why", "available"}


def _last_turn_is_user_question(turns: list) -> bool:
    """Returns True if the final turn is a USER asking something unanswered."""
    if not turns:
        return False
    last = turns[-1]
    speaker = last.speaker if hasattr(last, "speaker") else last.get("speaker", "")
    text = (last.text if hasattr(last, "text") else last.get("text", "")).lower()
    if speaker != "USER":
        return False
    return any(sig in text for sig in _QUESTION_SIGNALS)


async def grade_call(turns: list, overall_confidence: float = 1.0) -> GradingResult:
    """Grade a single call via LLM. Falls back to Non-Fatal on any error."""
    if not turns or not (settings.gemini_api_key or settings.openrouter_api_key or settings.groq_api_key):
        return GradingResult()

    transcript_text = _format_transcript(turns)

    # Add confidence context if notably low
    context = transcript_text
    if overall_confidence < 0.75:
        context = f"[Note: overall ASR confidence = {overall_confidence:.2f} — transcript may have errors]\n\n" + transcript_text

    log.info("Grading call: %d turns, confidence=%.2f", len(turns), overall_confidence)
    try:
        raw = await chat(_GRADING_SYSTEM, context, max_tokens=512, timeout=45.0)

        log.info("Grading raw response: %s", raw)
        # Strip markdown fences if present
        raw = re.sub(r"```(?:json)?\s*", "", raw).strip().rstrip("`").strip()

        data = json.loads(raw)
        grade = data.get("grade", "Non-Fatal")
        if grade not in ("Fatal", "Non-Fatal"):
            grade = "Non-Fatal"

        call_outcome = data.get("call_outcome", "completed")
        if call_outcome not in _VALID_OUTCOMES:
            call_outcome = "completed"

        category = data.get("category")
        if category not in _VALID_CATEGORIES:
            category = None
        if grade == "Non-Fatal":
            category = None

        risky_flags = [f for f in (data.get("risky_flags") or []) if f in _VALID_FLAGS]

        # Auto-add low_confidence flag
        if overall_confidence < 0.75 and "low_confidence" not in risky_flags:
            risky_flags.append("low_confidence")

        # Auto-add ignored_concern when bot closed but user's last turn is still a question
        if _last_turn_is_user_question(turns) and "ignored_concern" not in risky_flags:
            risky_flags.append("ignored_concern")
            log.info("Auto-flagged ignored_concern: last user turn is an unanswered question")

        result = GradingResult(
            grade=grade,
            call_outcome=call_outcome,
            category=category,
            reason=str(data.get("reason", ""))[:500],
            evidence=str(data.get("evidence", ""))[:300],
            evidence_timestamp=str(data.get("evidence_timestamp", "00:00")),
            evidence_turn=data.get("evidence_turn"),
            risky_flags=risky_flags,
        )
        log.info("Grade: %s | category: %s | flags: %s", result.grade, result.category, result.risky_flags)
        return result

    except Exception as exc:
        log.error("Grading failed: %s", exc)
        return GradingResult()
