"""GET /api/events — Server-Sent Events stream."""
import asyncio
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from services import events as ev

router = APIRouter()


@router.get("/api/events")
async def sse():
    q = ev.register()

    async def generate():
        try:
            # Send a heartbeat immediately so the browser confirms the connection
            yield ": heartbeat\n\n"
            while True:
                try:
                    event_type, payload = await asyncio.wait_for(q.get(), timeout=25)
                    yield f"event: {event_type}\ndata: {payload}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            ev.unregister(q)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
