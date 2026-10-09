Dashboard — Complete UI Specification

  ---
  Global Layout

  ┌─────────────────────────────────────────────────────────┐
  │  HEADER: Logo | Pipeline Status | Upload Button | Theme  │
  ├─────────────────────────────────────────────────────────┤
  │  TOP BAR: Summary Metrics (always visible)               │
  ├─────────────────────────────────────────────────────────┤
  │  TABS: Audit | Issues | Fix | Test | Prompt History      │
  ├─────────────────────────────────────────────────────────┤
  │  TAB CONTENT                                             │
  └─────────────────────────────────────────────────────────┘

  ---
  Header Bar
  
  - App name + logo
  - Pipeline status chip — Idle / Processing (47/100) / Clustering... / Done
  - Progress bar shown inline when processing
  - Upload Recordings button — opens modal to drop a zip or individual audio files
  - Dark/Light mode toggle
  - Notification bell — alerts for risky calls needing review, new results ready

  ---
  Top Summary Bar (always visible across all tabs)

  ┌──────────┬──────────┬──────────┬──────────┬──────────┬──────────┐
  │  Total   │  Fatal   │Non-Fatal │  Risky   │  Root    │ Prompt   │
  │  Calls   │  34      │  66      │  12      │  Causes  │ Version  │
  │  100     │  34%     │  66%     │  flagged │  Found 8 │  v3      │
  └──────────┴──────────┴──────────┴──────────┴──────────┴──────────┘

  Each card is clickable and navigates to the relevant tab.

  ---
  Tab 1 — Audit
  
  Left panel: Filters sidebar
  - Grade: All / Fatal / Non-Fatal
  - Risky only toggle
  - Category multi-select: wrong_capture / loop / wrong_info / incomplete / compliance / other
  - Language filter
  - Prompt version filter (which batch were these calls from)
  - ASR confidence range slider

  Main area: Calls table

  ┌─────┬─────────┬──────────┬──────────┬───────┬──────────┬────────┬───────┬────────────┬─────────┐
  │  #  │ Call ID │ Duration │ Language │ Grade │ Category │ Reason │ Risky │ Prompt Ver │ Actions │
  ├─────┼─────────┼──────────┼──────────┼───────┼──────────┼────────┼───────┼────────────┼─────────┤
  └─────┴─────────┴──────────┴──────────┴───────┴──────────┴────────┴───────┴────────────┴─────────┘

  - Grade column: colored badge (red Fatal / green Non-Fatal)
  - Risky column: flag icons (frustration / loop / asked for human / low confidence)
  - Click any row → opens Call Detail Drawer

  Call Detail Drawer (right side panel)
  - Call metadata: ID, date, duration, language, ASR confidence score
  - Grade verdict + reason
  - Risky flags if any
  - Full transcript — BOT/USER turns alternating (like a chat UI)
  - Evidence line highlighted in yellow with a "Why Fatal" tooltip
  - ASR confidence timeline — a small sparkline showing confidence dipping at key moments
  - "Replay with Current Prompt" button → runs simulation and shows new bot responses inline in the same transcript view, old response vs new response side by side
  - Which root cause this call belongs to (linked)

  Risky Calls Queue (below main table)
  - Separate card showing only risky-flagged calls
  - Flag reason shown prominently
  - "Mark Reviewed" button per call
  - Reviewed vs Pending count

  ---
  Tab 2 — Issues
  
  Top section: Charts row
  - Bar chart: Root cause name vs number of calls affected
  - Donut chart: Fatal / Non-Fatal split 
  - Trend line: Fatal rate over prompt versions (v1 → v2 → v3)

  Main area: Root Cause Cards (ranked)

  Each card:
  ┌──────────────────────────────────────────────────────┐
  │  #1  Bot doesn't confirm spec before closing    [Prompt Issue]
  │  ─────────────────────────────────────────────────── │
  │  Frequency: 23 calls (23%)    Severity: 87% Fatal    │
  │  Priority Score: 94  (freq × severity, explained ↗)  │
  │  ─────────────────────────────────────────────────── │
  │  Example calls: #42  #67  #91  +20 more              │
  │  ─────────────────────────────────────────────────── │
  │  [View All Calls]              [Go to Fix →]         │
  └──────────────────────────────────────────────────────┘

  - Type badge colors: Prompt Issue (blue) / ASR Issue (orange) / Knowledge Gap (purple) / Flow Logic (yellow)
  - Priority score has an info icon explaining the formula
  - Expand card → shows 2-3 transcript snippets as evidence
  - Cards sorted by priority score descending
  - Fixed/Unfixed status badge (once a prompt fix is approved)

  ---
  Tab 3 — Fix
  
  Prompt version selector at top
  - Dropdown: "Working against Prompt v3"
  - Shows what the current active prompt is

  Fix cards — one per root cause

  ┌──────────────────────────────────────────────────────┐
  │  Fix for: "Bot doesn't confirm spec before closing"  │
  │  Affects 23 calls  |  Priority Score: 94             │
  │  ─────────────────────────────────────────────────── │
  │  CURRENT PROMPT (excerpt):                           │
  │  "Confirm the requirement and find a seller match."  │
  │                                                      │
  │  SUGGESTED CHANGE:                                   │
  │  - Confirm the requirement and find a seller match.  │
  │  + Before proceeding, repeat the exact spec back:    │
  │  + "Aapko [X] chahiye, sahi hai?" Wait for confirm. │
  │  ─────────────────────────────────────────────────── │
  │  Expected calls repaired: ~21 of 23                  │
  │  ─────────────────────────────────────────────────── │
  │  Status: Pending Review                              │
  │  [Approve ✓]  [Reject ✗]  [Edit Fix]                │
  └──────────────────────────────────────────────────────┘

  - Diff shown with red/green highlighting (like GitHub diff view)
  - Approve button → moves to Test tab and triggers replay simulation
  - Edit Fix → inline editable text area for the prompt change
  - Multiple fixes can be approved together → merged into one new prompt version
  - "Preview Full New Prompt" button → shows entire prompt with all approved changes applied

  ---
  Tab 4 — Test
  
  Per-fix result cards

  ┌──────────────────────────────────────────────────────┐
  │  Test: "Bot doesn't confirm spec before closing"     │
  │  ─────────────────────────────────────────────────── │
  │  Before (Prompt v2):  Fatal rate  34%  (23/67 calls) │
  │  After  (Prompt v3):  Fatal rate   9%  ( 6/67 calls) │
  │  Delta:  -25%  ████████████░░░░  Verdict: ✓ Validated│
  │  ─────────────────────────────────────────────────── │
  │  Time: issue found → fix tested:  14 minutes         │
  │  ─────────────────────────────────────────────────── │
  │  Replayed calls: 23                                  │
  │  Repaired: 17   Still failing: 6   Regressed: 0      │
  │  ─────────────────────────────────────────────────── │
  │  [View Replayed Calls]                               │
  └──────────────────────────────────────────────────────┘

  - "View Replayed Calls" → opens a table of those 23 calls with old bot response vs new bot response side by side
  - Regressed count shown prominently in red if > 0

  Summary table across all fixes

  ┌────────────┬────────────┬────────┬───────┬───────┬─────────────┬────────┐
  │ Root Cause │ Prompt Ver │ Before │ After │ Delta │ Calls Fixed │ Status │
  ├────────────┼────────────┼────────┼───────┼───────┼─────────────┼────────┤
  └────────────┴────────────┴────────┴───────┴───────┴─────────────┴────────┘

  Regression alert banner
  - If any previously solved root cause reappears in new recordings, a red banner shows at top of this tab

  ---
  Tab 5 — Prompt History
  
  Version timeline (vertical, newest at top)

  ● Prompt v3  —  2026-10-09 14:32
    Fixed: "Bot doesn't confirm spec" | "Bot ignores objections"
    Fatal rate dropped: 34% → 9%
    Applied to: 67 calls in batch 2
    [View Full Diff]  [View Calls from this version]

  ● Prompt v2  —  2026-10-08 11:15
    Fixed: "Bot loops on unrecognised product"
    Fatal rate dropped: 51% → 34%
    Applied to: 100 calls in batch 1
    [View Full Diff]  [View Calls from this version]

  ● Prompt v1  —  Baseline (original)
    Fatal rate: 51%
    [View Original Prompt]

  - Each version expandable to show full prompt diff
  - Click "View Calls from this version" → filters Audit tab to that batch
  - Overall fatal rate trend chart across all versions shown at top of this tab

  ---
  Upload Modal
  
  - Drag and drop zone for zip or individual audio files
  - Shows file list with names and durations once uploaded
  - "Start Processing" button
  - Option to tag this batch with a label (e.g. "Week 42 calls")
  - Processing starts and header bar shows live progress

  ---
  Key Design Principles
  
  - Everything linked: a root cause card links to its calls, a fix links to its root cause, a test result links to replayed calls
  - No dead ends: every number is clickable and drills down
  - Status always visible: every call, fix, and test has a clear status badge
  - The loop is traceable: from any call you can see which root cause it belongs to, which fix addressed it, and whether that fix worked