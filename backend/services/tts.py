"""Sarvam Bulbul TTS — converts bot text to WAV audio bytes."""
import base64
import logging
import httpx
from config import settings

log = logging.getLogger(__name__)


async def text_to_speech(text: str) -> bytes | None:
    """Call Sarvam Bulbul TTS. Returns raw WAV bytes or None on failure."""
    if not settings.sarvam_api_key or not text.strip():
        return None

    # Pick language based on script composition
    hindi_chars = sum(1 for c in text if "ऀ" <= c <= "ॿ")
    lang = "hi-IN" if hindi_chars > 3 else "en-IN"

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                "https://api.sarvam.ai/text-to-speech",
                headers={"api-subscription-key": settings.sarvam_api_key},
                json={
                    "inputs": [text[:500]],
                    "target_language_code": lang,
                    "speaker": "ishita_en_customer",
                    "model": "bulbul:v4-flash",
                    "enable_preprocessing": True,
                },
            )
            resp.raise_for_status()
            audios = resp.json().get("audios", [])
            if not audios:
                return None
            return base64.b64decode(audios[0])
    except Exception as exc:
        log.warning("TTS failed: %s", exc)
        return None
