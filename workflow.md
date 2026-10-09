workflow : 
● Complete Detailed Workflow

  ---
  Stage 1 — Upload
  
  1. User opens dashboard, clicks Upload Recordings
  2. Drops a zip file of call recordings (e.g. calls_batch1.zip)
  3. System extracts all audio files, lists them in the modal with filename and duration
  4. User clicks Start Processing
  5. System creates a Batch record in DB:
  Batch #1 | 100 calls | Active Prompt: v1 | Status: Queued | Date: 2026-10-09
  6. All 100 calls added to a processing queue, one job per call
  7. Header bar switches to Processing (0/100)

  ---
  Stage 2 — Transcription (per call, as queue runs)
  
  For each call dequeued:

  1. Audio file sent to Saaras v4 with:
    - mode = "codemix" (handles Hindi+English)
    - language_code = "unknown" (auto-detect)
    - Speaker diarization enabled
    - Key terms: product names, categories relevant to Indiamart
  2. Saaras returns:
  {
    "transcript": [
      { "speaker": "BOT", "text": "Namaste...", "timestamp": "00:03", "confidence": 0.97 },
      { "speaker": "USER", "text": "2 inch pipes chahiye", "timestamp": "00:08", "confidence": 0.91 },
      { "speaker": "BOT", "text": "3 inch pipes noted", "timestamp": "00:12", "confidence": 0.95 }
    ],
    "language_detected": "hi-IN",
    "overall_confidence": 0.94
  }
  3. Also run verbatim mode in parallel on same audio → store both verbatim and normalized transcript
  4. Compare verbatim vs normalized → flag turns where they differ significantly (potential ASR misread)
  5. Transcript + confidence scores saved to DB against that call ID
  6. Header progress updates: Processing (1/100)

  ---
  Stage 3 — LLM Grading (immediately after each transcript is ready)
  
  1. Transcript passed to LLM grader with:
    - System prompt containing Fatal/Non-Fatal criteria
    - Full diarized transcript
    - temperature = 0
  2. LLM returns:
  {
    "grade": "Fatal",
    "reason": "Bot captured wrong spec despite user correction",
    "evidence": "User: '2 inch bola tha' → Bot: '3 inch 50 pieces confirmed'",
    "timestamp": "00:18",
    "category": "wrong_capture"
  }
  3. Risky flag check runs in parallel (separate LLM call or rule-based):
    - Scan for frustration keywords ("nahi nahi", "galat", "phir se")
    - Detect bot repeating same response 2+ times (loop)
    - Check if user said "insaan se baat" or "manager" (human request)
    - Check if ASR confidence drops below threshold (e.g. 0.75) at intent-capture moments
    - Returns array of flags: ["frustration", "wrong_capture"]
  4. Final record saved to DB:
  Call #42 | Fatal | wrong_capture | Risky: frustration | Batch #1 | Prompt v1
  5. Audit tab updates live — call #42 appears in the table with its grade and flags
  6. Top bar counters increment in real time

  ---
  Stage 4 — Root Cause Clustering (triggered when all calls in batch are graded)
  
  1. System detects queue is at 100/100
  2. Pulls all Fatal calls from this batch (say 34 calls)
  3. Extracts the reason and category field from each graded call
  4. Two-step clustering:

  4. Step A — Embedding
    - Send each reason string to an embedding model
    - Get a vector for each
    - Run k-means or DBSCAN clustering on the vectors
    - Similar reasons group together

  Step B — Cluster naming (LLM)
    - Send each cluster's reasons to LLM:
  These failed calls have similar reasons. Give this cluster:
  - A short name (5 words max)
  - A one-line description
  - A type: Prompt Issue / ASR Issue / Knowledge Gap / Flow Logic

  Reasons: [list of reasons in this cluster]
    - LLM returns cluster name + description + type
  5. Each cluster becomes a Root Cause record:
  Root Cause #1
  Name: "Bot doesn't confirm spec before closing"
  Type: Prompt Issue
  Calls affected: 23 (Call #42, #67, #91...)
  Frequency: 23%
  Severity: 87% of affected calls are Fatal
  Priority Score: (0.23 × 0.87 × 100) = 20.01 → normalized to 94
  6. Issues tab unlocks and populates with ranked root cause cards

  ---
  Stage 5 — Prompt Fix Generation (triggered after clustering)
  
  For each top root cause (e.g. top 3 by priority score):

  1. LLM receives:
    - Root cause name + description
    - 3-4 representative transcript excerpts from that cluster
    - Full current bot prompt (Prompt v1)
    - Instruction to suggest a minimal specific change
  2. LLM returns a structured diff:
  {
    "root_cause_id": 1,
    "current_excerpt": "Confirm the requirement and find a seller match.",
    "proposed_change": "Before proceeding, repeat the exact spec back: 'Aapko [X] chahiye, sahi hai?' Wait for user confirmation before proceeding.",
    "rationale": "23 calls failed because bot assumed spec without confirming. This forces explicit confirmation.",
    "expected_calls_repaired": 21
  }
  3. Fix saved to DB with status Pending Review
  4. Fix tab unlocks showing pending fix cards with diffs
  5. Notification sent: "3 prompt fixes ready for review"

  ---
  Stage 6 — Human Review of Fix
  
  1. Reviewer opens Fix tab
  2. Reads the diff for each root cause
  3. Three options:
    - Approve → fix moves to Test stage
    - Reject → fix discarded, root cause stays open
    - Edit then Approve → reviewer modifies the suggested change inline, then approves
  4. Multiple fixes can be approved together
  5. On approval, system merges all approved diffs into the current prompt → creates Prompt v2
  6. Prompt v2 saved to DB with:
  Prompt v2 | Created: 2026-10-09 14:32 | Fixes applied: #1, #3 | Based on: v1
  7. Prompt History tab updates with new version entry

  ---
  Stage 7 — Fix Testing (replay simulation)
  
  For each approved fix:

  1. Pull all calls belonging to that root cause (e.g. 23 calls for root cause #1)
  2. For each call, extract the USER turns only from the transcript
  3. Run a replay simulation:
  Turn 1: USER says X → send to Prompt v2 → get new BOT response
  Turn 2: USER says Y → send to Prompt v2 (with conversation history) → get new BOT response
  ... continue until end of call
  4. New simulated transcript generated for each call
  5. Run LLM grader on each new simulated transcript → get new grade
  6. Compare:
  Call #42 | Before: Fatal | After: Non-Fatal | Status: Repaired ✓
  Call #67 | Before: Fatal | After: Fatal     | Status: Still Failing ✗
  7. Aggregate results:
  Root Cause #1 — Before: 34% fatal | After: 9% fatal | Delta: -25%
  Repaired: 17/23 | Still failing: 6 | Regressed: 0
  Time: issue found → fix tested: 14 minutes
  8. Test tab populates with before/after cards
  9. Fix status updates to Validated or Needs Revision

  ---
  Stage 8 — Viewing a Specific Call
  
  User clicks any call in Audit tab:

  1. Call Detail Drawer opens
  2. Shows full transcript as chat bubbles (BOT left, USER right)
  3. Evidence line highlighted in yellow with tooltip "Why Fatal"
  4. ASR confidence sparkline below transcript — dips visible at problem moments
  5. If fix has been tested for this call's root cause:
    - Toggle appears: "Original" / "With Fix"
    - Switching shows old BOT responses replaced with new simulated responses
    - Repaired lines shown in green, still-failing lines in red
  6. Root cause badge shown — clicking it navigates to Issues tab filtered to that root cause

  ---
  Stage 9 — Upload More Recordings (next batch)
  
  1. User uploads calls_batch2.zip
  2. New Batch #2 created — tagged with Prompt v2 (currently active)
  3. Same pipeline runs: transcribe → grade → cluster
  4. Regression check runs automatically:
    - Compare new batch root causes against previously fixed root causes
    - If a fixed root cause reappears with >5% frequency → red regression alert on Test tab
  5. New root causes from batch 2 added to Issues tab
  6. New fixes suggested on top of Prompt v2 → Prompt v3 cycle begins
  7. Prompt History tab shows the growing version chain with fatal rate trend

  ---
  The Full Loop in One View

  Upload Batch
       ↓
  Saaras v4 → Transcripts (live, per call)
       ↓
  LLM Grader → Fatal/Non-Fatal + Risky flags (live, per call)
       ↓                    ↓
  Audit tab updates     Risky queue updates
       ↓
  [All graded] → Clustering → Root Causes ranked
       ↓
  Issues tab unlocks
       ↓
  LLM generates prompt diffs per root cause
       ↓
  Fix tab unlocks → Human reviews → Approve/Reject
       ↓
  Prompt v(n+1) created
       ↓
  Replay simulation runs on affected calls
       ↓
  Test tab shows before/after rates
       ↓
  Prompt History records the version + what changed + impact
       ↓
  Upload next batch → tagged to new prompt version
       ↓
  Regression check → loop continues

  ---
  Every stage feeds the next. Nothing is manual except the human approval of a fix — and even that is a single click on a pre-generated diff.