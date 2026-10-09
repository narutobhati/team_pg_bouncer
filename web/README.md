# Call Audit Loop — web dashboard

React + TypeScript + Vite + Tailwind + Framer Motion. Talks to the Go API over REST + Server-Sent Events, or runs the whole pipeline in the browser in mock mode.

## Run

```bash
cd web
npm install
npm run dev:mock     # full simulated pipeline, no backend needed → http://localhost:5173
npm run dev          # against the Go API (proxies /api → http://localhost:8080)
npm run build        # production build → dist/
```

Config (`.env.local`, see `.env.example`):

| Var | Default | Meaning |
|---|---|---|
| `VITE_API_URL` | empty (same origin) | Base URL of the Go API in production builds |
| `API_PROXY_TARGET` | `http://localhost:8080` | Where `npm run dev` proxies `/api` |
| `VITE_MOCK` | `0` | `1` = in-browser simulated pipeline (`.env.mock` sets it for `dev:mock`) |

## Demo script (mock mode)

1. **Upload recordings → Use sample batch → Start processing.** 100 calls grade live in the Audit table; header, counters and risky queue animate.
2. Clustering runs automatically → **Issues** unlocks with ranked root causes and charts.
3. **Fix** unlocks with 3 drafted prompt diffs → select all → **Approve → create v2**.
4. **Test** shows the replay simulation, then before/after per fix (one usually lands as *Needs Revision*).
5. Open any replayed call → drawer → **With fix** toggle shows old vs new bot turns.
6. Upload a second sample batch → it runs on v2, the fatal rate drops in **Prompt History**, and the regression check fires a red banner on **Test**.

The ↺ button in the header resets the demo.

## Go API contract

Implemented by `src/api/http.ts`; types in `src/types/api.ts` (snake_case JSON, passed through unmapped).

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/pipeline` | | `Pipeline` |
| GET | `/api/batches` | | `Batch[]` (oldest first) |
| POST | `/api/batches` | multipart: `files` (zip and/or audio, repeated), `label` | `Batch` — 409 if the pipeline is busy |
| GET | `/api/calls` | | `Call[]` (all batches; the UI filters client-side) |
| GET | `/api/calls/:id` | | `Call` |
| POST | `/api/calls/:id/review` | | `Call` (toggles `reviewed`) |
| POST | `/api/calls/:id/replay` | | `{ transcript: Turn[], grade }` — also store as `simulated_transcript` / `simulated_grade` |
| GET | `/api/root-causes` | | `RootCause[]` |
| GET | `/api/fixes` | | `Fix[]` |
| POST | `/api/fixes/approve` | `{ ids: number[], edits: { [fixId]: string } }` | `PromptVersion` (new active version; kick off replay tests) |
| POST | `/api/fixes/:id/reject` | | `Fix` |
| POST | `/api/fixes/preview` | `{ ids, edits }` | `{ text, diff }` without saving |
| GET | `/api/tests` | | `TestResult[]` (newest first) |
| GET | `/api/tests/:fixId/calls` | | `ReplayedCall[]` |
| GET | `/api/prompts` | | `PromptVersion[]` (newest first, with `fatal_rate` measured from calls on that version) |
| GET | `/api/regressions` | | `Regression[]` |
| GET | `/api/events` | | **SSE** stream (below) |

**SSE events.** Set `event:` to the type and `data:` to the JSON payload without the `type` field:

| `event:` | `data:` | When |
|---|---|---|
| `batch.created` | `{ batch }` | batch accepted |
| `batch.progress` | `{ pipeline }` | each graded call and every stage change (`processing → clustering → fixing → done`, `testing`) |
| `call.graded` | `{ call }` | a call finished transcription + grading |
| `call.updated` | `{ call }` | reviewed toggled, replay stored |
| `root_causes.ready` | `{ batch_id, count }` | clustering finished |
| `fixes.ready` | `{ count }` | fix drafts saved |
| `prompt.created` | `{ version }` | approval created a version |
| `test.done` | `{ results: TestResult[] }` | replay tests finished |
| `regression` | `{ regression }` | a fixed root cause reappeared above 5% |

Root-cause priority as computed by the mock: `round(100 × (1 − e^(−14 × frequency × severity)))`.
