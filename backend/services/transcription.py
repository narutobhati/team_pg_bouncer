"""Sarvam Saaras v4 transcription via Batch API with speaker diarization.

Flow per file:
  1. Create a batch job (with_diarization=True, model=saaras:v4, mode=codemix)
  2. Upload the audio file via Azure presigned URL
  3. Start the job
  4. Poll until Completed
  5. Download the output JSON and parse diarized_transcript
  6. Pass raw Sarvam entries (with speaker_id 0/1) to LLM
  7. LLM identifies which channel is BOT vs USER from content, returns final labels

Two concurrent jobs (codemix + verbatim) for ASR mismatch detection.
"""
import asyncio
import json
import logging
import re
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

import httpx
from sarvamai import AsyncSarvamAI

from config import settings
from services.llm import chat

log = logging.getLogger(__name__)

POLL_INTERVAL = 5   # seconds between status checks
JOB_TIMEOUT = 600   # max wait per job (10 min)

_LLM_SYSTEM = """\
You label speakers in transcripts of IndiaMART AI voice-bot calls (Hindi/English code-mix, ASR output — expect spelling noise, Roman/Devanagari mixing, and mis-split turns).

INPUT FORMAT
Each line: <index> [spk:X] <text>
X is the audio channel ID from diarization (0 or 1). Same X normally = same speaker, but diarization is occasionally wrong.

There are exactly two speakers:
- BOT  = IndiaMART's AI assistant "Tanya" (ASR may write Tania / Taniya / तान्या / टान्या / तनया). Female voice, scripted, collects requirement details.
- USER = the human buyer who posted the requirement. May be male or female.

METHOD (do this silently, do not output it)

Step 1 — Decide which channel is the BOT, using channel-level evidence.
Score each channel by adding up the anchors below across ALL of its lines. The channel with clearly more BOT evidence is the BOT channel.

  Strong BOT anchors (one is usually decisive):
  - Self-introduction: "मैं Tanya बोल रही हूं", "IndiaMART से बोल रही हूं", "calling from IndiaMART"
  - Call opener at the very start: "Hello/नमस्ते <Name> जी", followed by confirming the product requirement ("<product> की requirement है ना?")
  - Promises about sellers/next steps: "sellers से connect करवाऊंगी", "seller details WhatsApp पर भेजूंगी", "आपको calls आएंगी"
  - Requests for the caller's details: city, state, pincode, quantity, size, material, usage, budget, "कब तक चाहिए"

  Medium BOT anchors:
  - Scripted bridge + next question: "बहुत बढ़िया, तो...", "समझ गई, और...", "ठीक है, क्या...", "जी, नोट कर लिया"
  - Closing script: "धन्यवाद, आपका दिन शुभ हो", "IndiaMART चुनने के लिए धन्यवाद"
  - Feminine first-person verbs: "रही हूं", "समझ गई", "करूंगी", "भेजूंगी" (supporting only — a female buyer also uses these)

  Strong USER anchors (one is usually decisive):
  - Masculine first-person verbs: "बोल रहा हूं", "मैंने डाला था", "मैं देख लूंगा", "चाहिए था मुझे" (BOT is always feminine)
  - Informal/colloquial words: "भाई", "यार", "अपन", "अपने को", "मेरे को", "हम लोग", "अरे"
  - Addressing the bot: "ma'am", "madam", "मैडम", "आप कौन?", "कहाँ से बोल रहे हो?"
  - Own business context: "मेरी दुकान", "हमारी shop/factory", "हमारा काम", "हमें site पर चाहिए"
  - Giving the details the BOT asked for: city names, pincodes, numbers, sizes, brand/material choices
  - Questions about the deal, not about the other person's data: price/rate, delivery, GST, "seller कौन है?", "कितने दिन में आएगा?"
  - Confusion, interruption, complaints, "hello? आवाज़ नहीं आ रही", "busy हूं, बाद में call करो"

  Neutral (NEVER use these to decide the channel): short acks like "जी", "हाँ", "ठीक है", "okay", "हम्म", "thank you", "hello" — both speakers say them. Length is also neutral: users often give long explanations; the bot can have long scripted turns.

  Tie-breakers, in order:
  a) Whichever channel speaks the first substantive line (greeting + product) is usually BOT.
  b) Question → answer flow: the channel that asks for details is BOT; the channel that supplies them is USER.
  c) If only one channel appears in the whole transcript, skip Step 1 and label every line by content alone.

Step 2 — Label every line.
- Default: every line on the BOT channel = BOT, every line on the other channel = USER.
- Override the channel default ONLY when the line itself contains a STRONG anchor for the other speaker (e.g., a line on the USER channel says "मैं Tanya बोल रही हूं IndiaMART से", or a line on the BOT channel says "भाई मेरे को 50 piece चाहिए"). Never override based on neutral or medium cues alone.
- If one line clearly contains both speakers (merged turn), label it by whoever speaks the majority of the content.
- Use local flow as a sanity check: a BOT question is normally followed by a USER answer. Two consecutive lines from the same speaker are fine (pauses split turns), but a run of answer-like lines labeled BOT is a sign you mapped the channel wrong — recheck Step 1.

COMMON TRAPS
- "आप" alone does not mean BOT. BOT uses "आप" to REQUEST the caller's info ("आप अपना pincode बता दीजिए"); USER uses "आप" to ask about the deal or the bot ("आप rate बताइए", "आप कौन बोल रहे हो?") → USER.
- A USER repeating the bot's question ("city?", "pincode? 110001") is USER.
- The BOT never quotes prices, never names its own shop/business, never uses slang, never speaks in masculine first person.
- ASR may garble the bot's name or "IndiaMART" ("India Mart", "इंडिया मार्ट", "indiamart dot com") — treat all variants as the same anchor.
- Mid-call channel flip: diarization can reverse channel assignments mid-call after a long silence or dropped audio. If you notice the channel mapping seems to contradict itself (e.g., the same channel now has USER anchors after having BOT anchors earlier), switch to pure content-based labeling for the affected lines. Do NOT trust the channel alone after a flip.
- Presence check phrases are always BOT: "Hello क्या आप अभी line पे हैं?", "Hello? क्या आप सुन पा रहे हैं?", "क्या आप मुझे सुन सकते हैं?", "Are you there?" — the BOT asks these when the caller goes silent. Never USER.
- "Yes Ma'am", "हाँ Ma'am", "हाँ madam" are always USER — the buyer is addressing the bot as Ma'am. Never BOT.

EXAMPLE
Input:
0 [spk:1] नमस्ते Rakesh जी, मैं Tanya बोल रही हूं IndiaMART से। आपको steel almirah की requirement है ना?
1 [spk:0] हाँ जी, बोलिए
2 [spk:1] बहुत बढ़िया। कितने piece चाहिए आपको?
3 [spk:0] भाई अभी दो चाहिए, आप rate बता दो
4 [spk:1] Rate seller आपको बताएंगे। आप अपना city बता दीजिए
5 [spk:0] Jaipur
Output:
[{"index": 0, "speaker": "BOT"}, {"index": 1, "speaker": "USER"}, {"index": 2, "speaker": "BOT"}, {"index": 3, "speaker": "USER"}, {"index": 4, "speaker": "BOT"}, {"index": 5, "speaker": "USER"}]

OUTPUT RULES
- Return ONLY a JSON array — no explanation, no markdown, no code fences.
- Exactly one object per input line, in index order, covering every index from the input with none skipped or added.
- "speaker" must be exactly "BOT" or "USER".
[{"index": 0, "speaker": "BOT"}, {"index": 1, "speaker": "USER"}, ...]"""


@dataclass
class Turn:
    speaker: str              # "BOT" | "USER"
    text: str
    timestamp: str            # "mm:ss"
    confidence: float
    asr_mismatch: bool = False
    verbatim: str | None = None
    raw_speaker_id: str | None = None   # Sarvam channel id, kept for LLM context


@dataclass
class TranscriptResult:
    turns: list[Turn] = field(default_factory=list)
    language: str = "hi-IN"
    overall_confidence: float = 0.0
    duration_sec: int = 0
    audio_hash: str | None = None


def _seconds_to_ts(sec: float) -> str:
    m = int(sec) // 60
    s = int(sec) % 60
    return f"{m:02d}:{s:02d}"


async def _label_speakers_via_llm(turns: list[Turn]) -> list[Turn]:
    """Send Sarvam entries with their channel IDs to LLM for final BOT/USER assignment.

    The LLM sees the channel grouping (spk:0 vs spk:1) plus an explicit anchor
    (turn 0 is always the BOT greeting) to correctly identify which channel is BOT.
    Falls back to existing speaker values if LLM fails or returns unexpected output.
    """
    if not turns or not (settings.gemini_api_key or settings.openrouter_api_key):
        return turns

    # Detect BOT's channel from the first substantive turn (greeting + product question).
    # Skip very short fragments (≤3 words) that Sarvam sometimes prepends as noise.
    bot_channel = None
    for t in turns:
        if t.raw_speaker_id is not None and len(t.text.split()) > 3:
            bot_channel = t.raw_speaker_id
            break
    if bot_channel is None and turns:
        bot_channel = turns[0].raw_speaker_id
    user_channel = None
    if bot_channel is not None:
        user_channel = "1" if bot_channel == "0" else "0"

    # Format with Sarvam channel ids so LLM sees the grouping
    lines = [
        f"{i} [spk:{t.raw_speaker_id if t.raw_speaker_id is not None else '?'}]: {t.text}"
        for i, t in enumerate(turns)
    ]

    if bot_channel is not None:
        anchor = (
            f"Channel spk:{bot_channel} = BOT (confirmed from turn 0, which is always the BOT's opening greeting).\n"
            f"Channel spk:{user_channel} = USER.\n"
            f"Some individual turns may be mis-diarized to the wrong channel — fix those using content clues.\n\n"
        )
    else:
        anchor = "Identify which channel is BOT from content, then label each turn:\n\n"

    user_msg = anchor + "\n".join(lines)

    log.info("LLM speaker labeling: %d turns", len(turns))
    try:
        content = await chat(_LLM_SYSTEM, user_msg, max_tokens=4096, timeout=90.0, thinking=False)

        log.info("LLM raw response: %s", content)
        content = re.sub(r"```(?:json)?\s*", "", content).strip()
        match = re.search(r"\[.*\]", content, re.DOTALL)
        if not match:
            log.warning("LLM returned no JSON array, keeping Sarvam labels")
            return turns

        assignments = json.loads(match.group())
        if len(assignments) != len(turns):
            log.warning("LLM returned %d assignments for %d turns, keeping Sarvam labels", len(assignments), len(turns))
            return turns

        for a in assignments:
            idx = a.get("index")
            speaker = a.get("speaker")
            if idx is not None and 0 <= idx < len(turns) and speaker in ("BOT", "USER"):
                old = turns[idx].speaker
                t = turns[idx]
                turns[idx] = Turn(
                    speaker=speaker,
                    text=t.text,
                    timestamp=t.timestamp,
                    confidence=t.confidence,
                    asr_mismatch=t.asr_mismatch,
                    verbatim=t.verbatim,
                    raw_speaker_id=t.raw_speaker_id,
                )
                if old != speaker:
                    log.info("  turn %d: %s → %s [spk:%s] | %s", idx, old, speaker, t.raw_speaker_id, t.text[:60])

    except Exception as exc:
        log.error("LLM speaker labeling failed: %s", exc)

    return turns


_ALWAYS_USER = re.compile(
    r"(?:"
    r"\bma'?am\b"           # caller addressing bot as ma'am
    r"|\bmadam\b"
    r"|मैडम"
    r"|yes\s+ma'?am"
    r"|हाँ\s+ma'?am"
    r"|भाई\b"               # colloquial address, never used by BOT
    r"|(?<!\S)अपन(?!ी|े\s+को\s+नहीं|े\s+लिए)(?=\s|$|।)"  # "अपन" standalone, not "अपनी"/"अपने को"
    r"|अपने\s+को"
    r")",
    re.IGNORECASE,
)

_ALWAYS_BOT = re.compile(
    r"(?:"
    r"hello[?!,\s]*क्या\s+आप\s+अभी\s+line"   # presence check
    r"|क्या\s+आप\s+(?:अभी\s+)?(?:line|लाइन)\s+पे"
    r"|क्या\s+आप\s+(?:मुझे\s+)?सुन\s+(?:पा\s+)?रहे"
    r"|are\s+you\s+there"
    r"|मैं\s+Tan(?:ya|ia|iya)\s+बोल\s+रही\s+हूं"  # self-introduction
    r"|IndiaMART\s+से\s+बोल\s+रही\s+हूं"
    r"|seller\s+details.*WhatsApp"
    r"|sellers?\s+से\s+connect\s+करवा"
    r")",
    re.IGNORECASE,
)


def _apply_content_overrides(turns: list[Turn]) -> list[Turn]:
    """Deterministic post-LLM pass: fix high-confidence mis-labels the LLM missed.

    Applied after LLM labeling. Only overrides when the text contains an
    unambiguous marker — does not touch turns where content is neutral.
    """
    for i, t in enumerate(turns):
        text = t.text
        forced: str | None = None

        if _ALWAYS_USER.search(text):
            forced = "USER"
        elif _ALWAYS_BOT.search(text):
            forced = "BOT"

        if forced and forced != t.speaker:
            log.info("  override turn %d: %s → %s (content rule) | %s", i, t.speaker, forced, text[:60])
            turns[i] = Turn(
                speaker=forced,
                text=t.text,
                timestamp=t.timestamp,
                confidence=t.confidence,
                asr_mismatch=t.asr_mismatch,
                verbatim=t.verbatim,
                raw_speaker_id=t.raw_speaker_id,
            )
    return turns


async def _run_batch_job(file_path: str, mode: str) -> dict:
    """Submit a single-file batch job and return the parsed output JSON."""
    client = AsyncSarvamAI(api_subscription_key=settings.sarvam_api_key)
    job = await client.speech_to_text_job.create_job(
        model="saaras:v4",
        mode=mode,
        with_diarization=True,
        with_timestamps=True,
        language_code="unknown",
        num_speakers=2,
    )
    await job.upload_files([file_path])
    await job.start()
    await job.wait_until_complete(poll_interval=POLL_INTERVAL, timeout=JOB_TIMEOUT)

    with tempfile.TemporaryDirectory() as tmpdir:
        await job.download_outputs(tmpdir)
        fname = Path(file_path).name
        output_path = Path(tmpdir) / f"{fname}.json"
        with open(output_path) as f:
            return json.load(f)


async def transcribe(file_path: str) -> TranscriptResult:
    """Transcribe with diarization using Sarvam Batch API (codemix + verbatim passes)."""
    results = await asyncio.gather(
        _run_batch_job(file_path, "codemix"),
        _run_batch_job(file_path, "verbatim"),
        return_exceptions=True,
    )
    codemix_data, verbatim_data = results

    if isinstance(codemix_data, Exception):
        raise codemix_data

    language = codemix_data.get("language_code", "hi-IN")

    diarized = codemix_data.get("diarized_transcript") or {}
    entries = diarized.get("entries") or []

    if not entries and codemix_data.get("transcript"):
        entries = [{
            "transcript": codemix_data["transcript"],
            "start_time_seconds": 0.0,
            "end_time_seconds": 0.0,
            "speaker_id": None,
        }]

    verbatim_entries: list[dict] = []
    if not isinstance(verbatim_data, Exception):
        vd = verbatim_data.get("diarized_transcript") or {}
        verbatim_entries = vd.get("entries") or []

    turns: list[Turn] = []
    total_conf = 0.0
    max_end = 0.0

    for i, entry in enumerate(entries):
        text = (entry.get("transcript") or "").strip()
        if not text:
            continue

        start = float(entry.get("start_time_seconds") or 0.0)
        end = float(entry.get("end_time_seconds") or 0.0)
        raw_speaker_id = str(entry["speaker_id"]) if entry.get("speaker_id") is not None else None
        conf = 0.92

        total_conf += conf
        if end > max_end:
            max_end = end

        verbatim_text: str | None = None
        if i < len(verbatim_entries):
            verbatim_text = (verbatim_entries[i].get("transcript") or "").strip() or None

        mismatch = (
            verbatim_text is not None
            and verbatim_text.lower() != text.lower()
            and len(text) > 5
        )

        # Preliminary label — LLM will override this with the final assignment below
        preliminary_speaker = "BOT" if i % 2 == 0 else "USER"

        turns.append(Turn(
            speaker=preliminary_speaker,
            text=text,
            timestamp=_seconds_to_ts(start),
            confidence=round(conf, 2),
            asr_mismatch=mismatch,
            verbatim=verbatim_text if mismatch else None,
            raw_speaker_id=raw_speaker_id,
        ))

    # LLM sees Sarvam's channel grouping (spk:0 / spk:1) and assigns final BOT/USER labels
    turns = await _label_speakers_via_llm(turns)
    # Deterministic override for turns the LLM still gets wrong
    turns = _apply_content_overrides(turns)

    return TranscriptResult(
        turns=turns,
        language=language,
        audio_hash=codemix_data.get("audio_hash"),
        overall_confidence=round(total_conf / len(turns), 2) if turns else 0.0,
        duration_sec=int(max_end) or 0,
    )


def turns_to_dicts(turns: list[Turn]) -> list[dict]:
    return [
        {
            "speaker": t.speaker,
            "text": t.text,
            "timestamp": t.timestamp,
            "confidence": t.confidence,
            "asr_mismatch": t.asr_mismatch,
            "verbatim": t.verbatim,
        }
        for t in turns
    ]
