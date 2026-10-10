"""Shared LLM client — primary: Groq (llama-3.3-70b), fallback: OpenRouter (Claude Sonnet)."""
import logging
import httpx
from config import settings

log = logging.getLogger(__name__)

_GROQ_MODEL = "qwen/qwen3.8-27b"
_FALLBACK_MODEL = "anthropic/claude-sonnet-4-5"

# Force IPv4 for OpenRouter — IPv6 is blocked on this network.
_ipv4_transport = httpx.AsyncHTTPTransport(local_address="0.0.0.0")


async def chat(system: str, user: str, max_tokens: int = 1024, timeout: float = 60.0, **_) -> str:
    """Primary: OpenRouter Claude Sonnet. Fallback: Groq."""
    if settings.openrouter_api_key_personal or settings.openrouter_api_key:
        try:
            return await _openrouter_chat(system, user, max_tokens, timeout)
        except Exception as exc:
            log.warning("OpenRouter failed (%s), falling back to Groq", exc)
    return await _groq_chat(system, user, max_tokens, timeout)


async def chat_messages(system: str, messages: list[dict], max_tokens: int = 150, timeout: float = 20.0) -> str:
    """Multi-turn chat with full message history. Used for live conversations."""
    if settings.openrouter_api_key_personal or settings.openrouter_api_key:
        try:
            return await _openrouter_chat_messages(system, messages, max_tokens, timeout)
        except Exception as exc:
            log.warning("OpenRouter multi-turn failed (%s), falling back to Groq", exc)
    return await _groq_chat_messages(system, messages, max_tokens, timeout)




async def _groq_chat_messages(system: str, messages: list[dict], max_tokens: int, timeout: float) -> str:
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {settings.groq_api_key}", "Content-Type": "application/json"},
            json={"model": _GROQ_MODEL, "messages": [{"role": "system", "content": system}] + messages, "max_tokens": max_tokens, "temperature": 0.4},
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()


async def _openrouter_chat_messages(system: str, messages: list[dict], max_tokens: int, timeout: float) -> str:
    key = settings.openrouter_api_key_personal or settings.openrouter_api_key
    async with httpx.AsyncClient(transport=_ipv4_transport, timeout=timeout) as client:
        resp = await client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={"model": _FALLBACK_MODEL, "messages": [{"role": "system", "content": system}] + messages, "max_tokens": max_tokens, "temperature": 0.4},
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()


async def _groq_chat(system: str, user: str, max_tokens: int, timeout: float) -> str:
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.groq_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": _GROQ_MODEL,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "max_tokens": max_tokens,
                "temperature": 0,
            },
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()


async def _openrouter_chat(system: str, user: str, max_tokens: int, timeout: float) -> str:
    key = settings.openrouter_api_key_personal or settings.openrouter_api_key
    async with httpx.AsyncClient(transport=_ipv4_transport, timeout=timeout) as client:
        resp = await client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            json={
                "model": _FALLBACK_MODEL,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "max_tokens": max_tokens,
                "temperature": 0,
            },
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()
