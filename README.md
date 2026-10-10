# Call Audit Loop — Team PG Bouncer

An automated, closed-loop quality improvement system for **Tanya** — IndiaMART's AI voice assistant. The system ingests raw call recordings, grades every call, finds the root causes of failures, generates targeted prompt fixes, tests them before shipping, and tracks prompt version history — all with minimal human intervention.

---

## The Problem

IndiaMART's AI voice bot "Tanya" makes outbound calls to B2B buyers who have posted product requirements on the platform. Her job is to confirm the requirement, collect key details (product, quantity, specifications, location), and tell the buyer that relevant sellers will reach out.

Call quality issues — loops, wrong data capture, ignoring the buyer's questions, premature call endings — are identified only after the fact, manually, at scale. There is no automated mechanism to:
- Identify which calls failed and why
- Cluster failures into systemic root causes
- Generate a minimal, targeted prompt fix
- Validate the fix before pushing it live
- Track how the prompt has evolved across batches

This system solves all of that.

---

## How It Works — The Loop

```
Upload Recordings
       │
       ▼
  [1] GRADE
  Sarvam Batch STT (saaras:v4) + LLM speaker labeling
  → Every call graded Fatal / Non-Fatal with evidence
       │
       ▼
  [2] CLUSTER
  LLM groups Fatal calls into 1–5 root causes
  (Prompt Issue / ASR Issue / Knowledge Gap / Flow Logic)
       │
       ▼
  [3] FIX
  LLM generates one minimal prompt change per root cause
  → Human reviews, edits, and approves fixes in the UI
       │
       ▼
  [4] PROVE (Test)
  Approved fixes replay against the original Fatal calls
  LLM re-grades each call "as if the fix were applied"
  → Verdict: Validated ✓ or Needs Revision ✗
       │
       ▼
  New prompt version created → loop begins again on next batch
```

Real-time progress is streamed to the frontend via **Server-Sent Events** so the user can watch the pipeline advance stage by stage.

---

## Key Features

### Transcription with Speaker Diarization
- Audio recordings are submitted to **Sarvam Batch STT API** (`saaras:v4`) in two passes: `codemix` (for Hindi/English code-mix) and `verbatim` (for ASR mismatch detection).
- Sarvam returns diarized entries with raw channel IDs (`spk:0`, `spk:1`).
- An LLM pass (Claude Sonnet) then assigns the correct **BOT** or **USER** label to every turn, using content anchors (Tanya's self-introduction, scripted transitions, seller-connection promises) and diarization channel groupings.
- A deterministic rule-based override layer catches high-confidence mis-labels the LLM misses (e.g. `"हाँ ma'am"` is always USER; `"क्या आप अभी line पे हैं?"` is always BOT).
- ASR mismatch between the two passes is flagged per-turn for debugging.

### LLM-Based Call Grading
- Every call transcript is sent to **Claude Sonnet** with a detailed grading rubric.
- Grades: **Fatal** (clearly broken bot behavior) or **Non-Fatal**.
- Fatal categories: `wrong_capture`, `loop`, `wrong_info`, `incomplete`, `ignored_refusal`, `empathy_failure`, `compliance`, `other`.
- Call outcomes: `completed`, `not_interested`, `already_fulfilled`, `wrong_person`, `callback_requested`, `user_dropped`, `bot_failed`.
- Risky flags (non-fatal signals): `frustration`, `loop`, `human_request`, `wrong_capture`, `pushy`, `ignored_concern`, `low_confidence`.
- The grader is tuned for Hinglish, noisy ASR, and IndiaMART's specific call script — location not being captured is explicitly **not** a failure (it's on the buyer's profile).

### Root Cause Clustering
- All Fatal calls from a batch are sent to the LLM for unsupervised grouping into 1–5 root causes.
- Each root cause gets a short name, a description of the systemic failure pattern, and a type tag.
- Priority score is computed from frequency and fatal rate.

### Prompt Fix Generation
- For each root cause, the LLM is given the current active prompt + root cause description + example failure transcript snippets.
- It returns a minimal, targeted fix: which line of the prompt to change (`current_excerpt`) and what to replace it with (`proposed_change`), along with rationale and an estimated repair percentage.
- Fixes appear in the **Fix tab** for human review. Reviewers can edit the proposed change inline before approving.

### Replay Testing
- When a fix is approved, the system replays every Fatal call linked to that root cause.
- Each transcript is re-graded by the LLM with a modified system prompt that appends: *"The bot's prompt has been updated with this fix — re-evaluate as if the bot had followed it."*
- If more than half the calls go from Fatal → Non-Fatal, the fix is **Validated**. Otherwise: **Needs Revision**.
- A new **prompt version** is created from approved fixes and stored with a full diff.

### Live Interactive Testing
- Before or after approval, a reviewer can click **Live Test** to have a real voice conversation with Tanya running the fixed prompt.
- The reviewer speaks into their microphone → audio is transcribed in real-time by **Sarvam Synchronous STT** (`saaras:v3`) → sent to Claude Sonnet playing Tanya → response is spoken back via **Sarvam TTS** (`bulbul:v4-flash`, `ishita_en_customer` voice).
- At the end of the live test, the conversation is graded and the fix is marked `human_validated = True`, which prevents the automated replay test from raising a false regression.

### Regression Detection
- After testing, if a fix that was "Validated" for one root cause causes failures on others, a **regression alert** fires.
- Human-validated fixes skip the automated regression check — if a human already proved the fix works on a live call, the automated re-grade is treated as informational only.

### Prompt Version History
- Every approved fix creates a new versioned prompt (`v1`, `v2`, `v3`, …).
- The Prompt History tab shows the full diff between versions, which root causes were fixed in each version, and the projected fatal rate.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                     FRONTEND                         │
│  React 18 + TypeScript + Vite                        │
│  TailwindCSS + Framer Motion (animations)            │
│  TanStack Query (server state)                       │
│  Zustand (UI state)                                  │
│  React Router v6                                     │
│  Lucide React (icons)                                │
│                                                      │
│  Tabs: Audit | Issues | Fix | Test | Prompt History  │
└─────────────────┬───────────────────────────────────┘
                  │  HTTP + SSE (port 5173 → 8080)
┌─────────────────▼───────────────────────────────────┐
│                     BACKEND                          │
│  FastAPI + Uvicorn (Python 3.11+)                    │
│  SQLAlchemy 2.0 ORM                                  │
│  SQLite (hackathon.db)                               │
│  Background tasks for pipeline stages                │
│  Server-Sent Events for real-time pipeline updates   │
└──────┬──────────────────────────┬───────────────────┘
       │                          │
┌──────▼──────┐           ┌───────▼──────────┐
│  SARVAM AI  │           │   OPENROUTER /   │
│             │           │   GROQ           │
│  STT Batch  │           │                  │
│  saaras:v4  │           │  Primary:        │
│  (diarized) │           │  Claude Sonnet   │
│             │           │  4.5 (OpenRouter)│
│  STT Sync   │           │                  │
│  saaras:v3  │           │  Fallback:       │
│  (live)     │           │  Qwen 3.8-27B   │
│             │           │  (Groq)          │
│  TTS        │           │                  │
│  bulbul:v4  │           │  Tasks: speaker  │
│  ishita_en  │           │  labeling, gradi-│
│  _customer  │           │  ng, clustering, │
│             │           │  fix gen, replay,│
│             │           │  live chat       │
└─────────────┘           └──────────────────┘
```

---

## Sarvam AI Integration

| API | Model / Endpoint | Usage |
|-----|-----------------|-------|
| Speech-to-Text Batch | `saaras:v4` | Transcribing uploaded call recordings with speaker diarization. Two concurrent passes: `codemix` (Hindi/English) + `verbatim` (ASR mismatch detection). |
| Speech-to-Text Sync | `saaras:v3` | Real-time transcription of live voice turns during interactive fix testing. Single audio chunk → transcript in ~1–2 seconds. |
| Text-to-Speech | `bulbul:v4-flash` + `ishita_en_customer` | Converts Tanya's bot replies to WAV audio during live tests. Language auto-detected (Hindi vs English) based on Devanagari character count. |

The Sarvam Python SDK (`sarvamai`) is used for batch jobs (create → upload → start → poll → download). Sync STT and TTS use direct HTTP calls via `httpx`.

---

## LLM Usage (OpenRouter / Groq)

All intelligence in the pipeline runs through a single `services/llm.py` module with automatic fallback:

| Task | System Prompt | Primary Model |
|------|--------------|---------------|
| Speaker diarization labeling | Detailed BOT/USER anchor rules, Hinglish-aware | Claude Sonnet 4.5 |
| Call grading | Full Fatal/Non-Fatal rubric with 8 categories, 8 risky flags | Claude Sonnet 4.5 |
| Root cause clustering | Group Fatal calls into 1–5 systemic patterns | Claude Sonnet 4.5 |
| Prompt fix generation | Generate minimal targeted prompt change | Claude Sonnet 4.5 |
| Replay testing | Re-grade transcripts "as if fix were applied" | Claude Sonnet 4.5 |
| Live conversation | Tanya playing the fixed prompt in a voice call | Claude Sonnet 4.5 |

**Fallback chain:** OpenRouter (personal key) → OpenRouter (team key) → Groq (Qwen 3.8-27B)

---

## Tech Stack Summary

**Backend**
- Python 3.11+
- FastAPI 0.115 — REST API + SSE streaming
- Uvicorn — ASGI server
- SQLAlchemy 2.0 — ORM with SQLite
- httpx — async HTTP client for all external API calls
- sarvamai SDK — Sarvam Batch STT
- pydantic-settings — environment config

**Frontend**
- React 18 + TypeScript
- Vite 5 — build tooling
- TailwindCSS 3 — styling
- Framer Motion 10 — animations and transitions
- TanStack Query 5 — data fetching and caching
- Zustand 5 — lightweight UI state
- React Router 6 — tab navigation
- Lucide React — icons

---

## Setup

### Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# Fill in your keys in .env

python main.py          # runs on port 8080
# or
./run.sh
```

**Required `.env` keys:**

```env
SARVAM_API_KEY=your_sarvam_key          # STT + TTS
OPENROUTER_API_KEY=your_openrouter_key  # Claude Sonnet (primary LLM)
GROQ_API_KEY=your_groq_key              # Qwen fallback LLM
```

Optional:
```env
OPENROUTER_API_KEY_PERSONAL=...         # personal key takes priority over team key
GEMINI_API_KEY=...                      # unused in current flow, reserved
PORT=8080
DATABASE_URL=sqlite:///./hackathon.db
UPLOAD_DIR=./uploads
```

### Frontend

```bash
cd web
npm install
npm run dev       # dev server on port 5173
```

---

## Project Structure

```
team_pg_bouncer/
├── backend/
│   ├── main.py               # FastAPI app, startup, CORS
│   ├── config.py             # Pydantic settings (reads .env)
│   ├── database.py           # SQLAlchemy engine, migrations
│   ├── models.py             # ORM models: Call, Batch, RootCause, Fix, PromptVersion, …
│   ├── schemas.py            # Pydantic response schemas
│   ├── requirements.txt
│   ├── .env.example
│   ├── run.sh
│   ├── routes/
│   │   ├── batches.py        # Upload → transcribe → grade pipeline trigger
│   │   ├── calls.py          # Call listing and detail
│   │   ├── root_causes.py    # Cluster trigger and listing
│   │   ├── fixes.py          # Fix CRUD, approve/reject, replay test trigger
│   │   ├── prompts.py        # Prompt version history
│   │   ├── live_test.py      # Live voice conversation endpoints
│   │   ├── tests.py          # Test result listing
│   │   ├── events.py         # SSE /events stream
│   │   └── pipeline.py       # Pipeline stage state
│   └── services/
│       ├── llm.py            # OpenRouter / Groq client with fallback
│       ├── transcription.py  # Sarvam Batch STT + LLM speaker labeling
│       ├── grading.py        # LLM call grader (Fatal / Non-Fatal)
│       ├── clustering.py     # LLM root cause clusterer
│       ├── fixing.py         # LLM fix generator
│       ├── testing.py        # Replay test (re-grading with fix)
│       ├── conversation.py   # In-memory live session manager
│       ├── tts.py            # Sarvam Bulbul TTS
│       ├── processor.py      # Orchestrates the full pipeline per batch
│       └── events.py         # SSE broadcaster
└── web/
    └── src/
        ├── features/
        │   ├── audit/        # Call list + transcript drawer
        │   ├── issues/       # Root cause cards + risky call queue
        │   ├── fix/          # Fix review, edit, approve, live test
        │   ├── test/         # Replay test results
        │   └── history/      # Prompt version timeline
        ├── api/              # HTTP client + React Query hooks
        ├── components/       # Shared UI (Diff, Badges, Charts, …)
        └── layout/           # Header, tabs, pipeline status chip
```

---

## The Prompt Versioning Model

Each approved fix creates a new prompt version:

```
v1 (seed)  →  v2 (fix: loop issue)  →  v3 (fix: empathy failure)  →  …
```

Each version stores:
- Full prompt text
- Line-level diff from the previous version
- Which fix IDs were applied
- Which root causes were resolved
- Projected fatal rate (from replay test results)
- Number of live calls applied against it

Only one version is active at a time. The active version is used as the base for new fixes.

---

## Team

**Team PG Bouncer** — IndiaMART Hackathon 2026
