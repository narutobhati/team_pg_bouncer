"""In-memory live conversation sessions — buyer vs bot (fixed prompt)."""
import uuid
import logging
from datetime import datetime
from services.llm import chat_messages

log = logging.getLogger(__name__)

# session_id → session dict (ephemeral, lives only in process memory)
_sessions: dict[str, dict] = {}

_BOT_SYSTEM = """\
{prompt}

─────────────────────────────────────────────
LIVE CALL INSTRUCTIONS
─────────────────────────────────────────────
You are "Tanya", IndiaMART's AI voice assistant (female, warm, professional).
This is a live voice call. Rules:
- Keep every response to 1-3 short sentences MAX — voice calls need brevity.
- Match the buyer's language (Hindi / English / Hinglish). Default: Hinglish.
- Do NOT use bullet points, lists, asterisks, or markdown — speak naturally.
- Do NOT start every reply with "Namaste" or repeat greetings.
- Do NOT say you are an AI unless directly asked.
- If the buyer wants to end, close warmly: "IndiaMART sunne ke liye dhanyawaad. Aapka din shubh ho."
{buyer_context}"""

_BUYER_CONTEXT_BLOCK = """
─────────────────────────────────────────────
HOW TO OPEN THIS CALL
─────────────────────────────────────────────
Start the call with these exact lines (or very close to them):
"{buyer_requirement}"

After that, let the conversation flow naturally based on what the buyer says.
"""


async def start_session(fix_id: int, prompt_text: str, root_cause_name: str, buyer_requirement: str = "") -> dict:
    session_id = str(uuid.uuid4())[:8]
    buyer_ctx = _BUYER_CONTEXT_BLOCK.format(buyer_requirement=buyer_requirement) if buyer_requirement else ""
    system = _BOT_SYSTEM.format(prompt=prompt_text, buyer_context=buyer_ctx)

    # Bot opens the call
    opening = await chat_messages(
        system,
        [{"role": "user", "content": "<<call_started>> The call just connected. Open the call naturally."}],
        max_tokens=80,
        timeout=20.0,
    )

    session = {
        "id": session_id,
        "fix_id": fix_id,
        "prompt_text": prompt_text,
        "root_cause_name": root_cause_name,
        "system": system,
        "messages": [{"role": "assistant", "content": opening}],
        "started_at": datetime.utcnow().isoformat(),
        "ended": False,
    }
    _sessions[session_id] = session
    log.info("Live session %s started (fix_id=%s)", session_id, fix_id)
    return {"session_id": session_id, "opening": opening}


async def send_turn(session_id: str, buyer_text: str) -> str:
    session = _sessions.get(session_id)
    if not session or session["ended"]:
        raise ValueError("Session not found or already ended")

    session["messages"].append({"role": "user", "content": buyer_text})

    bot_reply = await chat_messages(
        session["system"],
        session["messages"],
        max_tokens=120,
        timeout=20.0,
    )
    session["messages"].append({"role": "assistant", "content": bot_reply})
    return bot_reply


def get_session(session_id: str) -> dict | None:
    return _sessions.get(session_id)


def end_session(session_id: str) -> list[dict]:
    """Mark session ended and return transcript as turn dicts."""
    session = _sessions.get(session_id)
    if not session:
        return []
    session["ended"] = True

    turns = []
    for msg in session["messages"]:
        if msg["content"].startswith("<<"):
            continue
        turns.append({
            "speaker": "BOT" if msg["role"] == "assistant" else "USER",
            "text": msg["content"],
            "timestamp": "00:00",
            "confidence": 1.0,
            "asr_mismatch": False,
        })
    return turns
