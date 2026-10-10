"""In-memory SSE broadcast bus. One asyncio.Queue per connected client."""
import asyncio
import json
from typing import Any

_queues: set[asyncio.Queue] = set()

# Global pipeline state — single source of truth for GET /api/pipeline
pipeline_state: dict[str, Any] = {
    "stage": "idle",
    "batch_id": None,
    "processed": 0,
    "total": 0,
    "active_prompt": "v1",
}


def register() -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue()
    _queues.add(q)
    return q


def unregister(q: asyncio.Queue) -> None:
    _queues.discard(q)


def broadcast(event_type: str, data: dict) -> None:
    """Push an SSE event to every connected client (fire-and-forget)."""
    payload = json.dumps(data)
    dead = set()
    for q in _queues:
        try:
            q.put_nowait((event_type, payload))
        except asyncio.QueueFull:
            dead.add(q)
    _queues.difference_update(dead)


def update_pipeline(**kwargs) -> None:
    pipeline_state.update(kwargs)
    broadcast("batch.progress", {"pipeline": pipeline_state.copy()})
