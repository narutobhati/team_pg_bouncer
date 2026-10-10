from contextlib import asynccontextmanager
from datetime import datetime
import logging

import uvicorn

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(name)s: %(message)s")
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from database import init_db, SessionLocal
from models import PromptVersion
from routes import batches, calls, events, fixes, live_test, pipeline, prompts, root_causes, tests

BASE_PROMPT = """\
You are an AI voice assistant for IndiaMART, India's largest B2B marketplace.
Your job is to understand the buyer or seller's requirement and connect them with the right match.

Guidelines:
- Greet the user warmly in Hindi or English based on their preference.
- Ask for the product or service they need, including quantity and specifications.
- Confirm the requirement back to the user before proceeding.
- If the user speaks in Hinglish (Hindi + English), respond in kind.
- Do not provide pricing unless you have verified data.
- If the user asks to speak to a person, acknowledge and escalate immediately.
- End the call only after the user's goal is met or they explicitly want to end.
"""


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    init_db()
    _seed_prompt_v1()
    yield
    # Shutdown — nothing to clean up for SQLite


def _seed_prompt_v1():
    with SessionLocal() as db:
        existing = db.get(PromptVersion, "v1")
        if existing:
            return
        lines = BASE_PROMPT.strip().split("\n")
        diff = [{"kind": "context", "text": line} for line in lines]
        pv = PromptVersion(
            version="v1",
            created_at=datetime.utcnow(),
            fixes_applied=[],
            fixed_root_causes=[],
            text=BASE_PROMPT.strip(),
            diff=diff,
            calls_applied=0,
            batch_ids=[],
            active=True,
        )
        db.add(pv)
        db.commit()


app = FastAPI(title="Call Audit API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(events.router)
app.include_router(pipeline.router)
app.include_router(batches.router)
app.include_router(calls.router)
app.include_router(prompts.router)
app.include_router(root_causes.router)
app.include_router(fixes.router)
app.include_router(live_test.router)
app.include_router(tests.router)


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=settings.port,
        reload=True,
        reload_excludes=["venv", "*.pyc", "__pycache__"],
    )
