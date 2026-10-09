---
name: callaudit-dashboard-ui
description: Build and extend the Call Audit Loop dashboard frontend (React + TS + Tailwind + Framer Motion + Recharts/D3) against the Go API. Load before writing any UI, chart, animation, or API-client code in this repo. Covers stack, layout, design tokens, motion system, chart rules, data contracts, and the mock pipeline used for demos.
---

# Call Audit Loop — Dashboard UI Skill

Source of truth for *what* to build: `workflow.md` (pipeline) and `ui.md` (screens).
This file defines *how* to build it so every screen reads as one polished system.

> North star: **a live, animated, traceable loop.** Every number drills down, every
> status is visible, and the pipeline visibly *moves* (upload → transcribe → grade →
> cluster → fix → test → new prompt version).

---

## 1. Stack

| Concern | Choice |
|---|---|
| Framework | React 18 + Vite + TypeScript (strict) |
| Styling | Tailwind CSS, colors via CSS custom properties (tokens below) |
| Motion | Framer Motion (`motion`, `AnimatePresence`, `layout`, `LayoutGroup`) |
| Charts | Hand-built SVG components in `web/src/components/charts/` (BarList, Donut, TrendLine, ConfidenceSparkline, DeltaBars) — no chart library |
| State / data | TanStack Query for server state; Zustand for UI state (theme, batch scope, notifications); filters and the open call live in the URL |
| Routing | React Router — tabs are routes: `/audit`, `/issues`, `/fix`, `/test`, `/history` |
| Icons | lucide-react |
| Live updates | SSE (`EventSource`) from the Go API, bridged into the TanStack Query cache by `useLiveEvents` |
| Font | `Inter` (UI) + `JetBrains Mono` (prompt diffs, transcripts IDs) |

Folder layout:
```
web/
  src/
    api/          # typed client + SSE hook + mock server
    components/   # shared: StatCard, Badge, Drawer, Modal, Diff, Sparkline…
    features/
      audit/ issues/ fix/ test/ history/ upload/
    layout/       # Header, SummaryBar, Tabs
    theme/        # tokens.css, motion.ts
    types/        # mirrors Go API JSON
```

---

## 2. Global layout (from ui.md)

```
HEADER       Logo | Pipeline status chip + progress | Upload | Bell | Theme
SUMMARY BAR  Total | Fatal | Non-Fatal | Risky | Root Causes | Prompt Version  (sticky, clickable)
TABS         Audit | Issues | Fix | Test | Prompt History  (animated underline)
CONTENT      route outlet with page transitions
```
- Header + summary bar are sticky; content scrolls.
- Tabs that are not yet unlocked (Issues before clustering, Fix before fixes, Test
  before approval) render disabled with a lock icon + tooltip of what unlocks them.
- Phone width: summary cards become a horizontal snap-scroll row; filters sidebar
  collapses into a sheet. 16px gutter, no horizontal page scroll.

---

## 3. Design tokens

Dark-first "glass" aesthetic. Define on `:root`; dark under both
`@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` and
`:root[data-theme="dark"]`. Always set an explicit `body` background.

| Token | Light | Dark |
|---|---|---|
| `--bg` (page) | `#f6f7fb` | `#0a0b10` |
| `--surface-1` (card) | `#ffffff` | `#12141c` |
| `--surface-2` (raised/hover) | `#f1f2f7` | `#1a1d28` |
| `--glass` | `rgba(255,255,255,.7)` | `rgba(18,20,28,.6)` + `backdrop-blur(16px)` |
| `--border` | `rgba(11,11,11,.08)` | `rgba(255,255,255,.08)` |
| `--text-1` | `#0b0b0f` | `#f5f6fa` |
| `--text-2` | `#52525b` | `#a1a1aa` |
| `--text-muted` | `#8a8a93` | `#71717a` |
| `--accent` | `#5b5bf7` | `#7c7cff` |
| `--accent-glow` | — | `0 0 24px rgba(124,124,255,.35)` |

Background flourish (dark only): two slow-drifting blurred radial gradients
(accent + teal at 8–12% opacity) behind the content. Never behind charts' plot area.

### Semantic (status) colors — reserved, always with icon + label
| Role | Hex | Used for |
|---|---|---|
| good | `#0ca30c` | Non-Fatal, Repaired, Validated, Approved |
| warning | `#fab219` | Pending Review, Risky, low ASR confidence |
| serious | `#ec835a` | Needs Revision |
| critical | `#d03b3b` | Fatal, Still Failing, Regressed, Regression alert |

### Root-cause type badges (categorical, fixed mapping — never by rank)
| Type | Light | Dark |
|---|---|---|
| Prompt Issue | `#2a78d6` (blue) | `#3987e5` |
| ASR Issue | `#eb6834` (orange) | `#d95926` |
| Knowledge Gap | `#4a3aa7` (violet) | `#9085e9` |
| Flow Logic | `#eda100` (yellow) | `#c98500` |

Badge = tinted background (hue @ 14% alpha) + colored dot + text in `--text-1`.
Text never wears the data color.

### Chart categorical order (if a chart needs >1 series)
blue `#2a78d6` → orange `#eb6834` → aqua `#1baf7a` → yellow `#eda100` → magenta
`#e87ba4` → green `#008300` → violet `#4a3aa7` → red `#e34948`.
Fixed order, never cycled; >8 series folds into "Other".

---

## 4. Motion system (`theme/motion.ts`)

Motion should feel *alive but calm*. One vocabulary, reused everywhere.

```ts
export const spring = { type: "spring", stiffness: 380, damping: 32 };
export const softSpring = { type: "spring", stiffness: 200, damping: 26 };
export const ease = [0.22, 1, 0.36, 1] as const;      // easeOutExpo-ish

export const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show:   { opacity: 1, y: 0, transition: { duration: .45, ease } },
};
export const stagger = (s = 0.05) => ({ show: { transition: { staggerChildren: s } } });
```

| Element | Motion |
|---|---|
| Page/tab change | `AnimatePresence mode="wait"`, fade + 8px slide, 250ms |
| Tab underline | shared `layoutId="tab-underline"` |
| Summary cards | count-up numbers (animate from previous value, 600ms), pulse ring when value changes |
| Pipeline chip | progress ring/bar fills smoothly; shimmer sweep while Processing; morphs label (Idle → Processing 47/100 → Clustering… → Done ✓) |
| New call row (live) | slides in from top with a 1.2s highlight wash in accent @ 12% |
| Card grids | stagger children 50ms on mount |
| Root-cause cards | `layout` reorder animation when priority changes |
| Drawer | slides from right with `spring`, backdrop fades; transcript bubbles stagger in |
| Modal | scale .96 → 1 + fade |
| Diff approve | card flashes good-green border, check icon draws (pathLength 0→1), card collapses into Test tab counter |
| Reject | subtle x-shake (±4px, 2 cycles), fades to 50% |
| Charts | bars grow from baseline, lines draw left→right, donut sweeps — on first view only |
| Delta bars (Test) | before bar shrinks to after value, delta label counts |
| Tab unlock | lock icon morphs to open, tab glows once |

Rules:
- Respect `prefers-reduced-motion`: disable translate/scale, keep opacity fades ≤150ms.
- Never animate on every data refetch — only on *change*. Refetch keeps the previous
  render at reduced opacity (no skeleton flash).
- Skeletons only on first load.
- Durations: micro 150ms, standard 250ms, emphasis 450–600ms. Nothing > 800ms.

---

## 5. Chart rules (dataviz method — non-negotiable)

| Screen | Chart | Form notes |
|---|---|---|
| Issues | Root cause vs calls affected | Horizontal bar (long names), one color (slot 1), sorted desc, value at bar tip |
| Issues | Fatal / Non-Fatal split | Donut, 2 segments using status critical/good, center label = fatal % |
| Issues + History | Fatal rate over prompt versions | Line, 2px, ≥8px end-dots with 2px surface ring, label the last point |
| Drawer | ASR confidence timeline | Sparkline (area @10% + 2px line), threshold 0.75 as a solid hairline, dips below threshold get warning dots |
| Test | Before vs after fatal rate | Dumbbell or paired bar per fix; delta label in good/critical text token |

- **One y-axis per chart.** Never dual-axis.
- Bars ≤24px thick, 4px rounded data-end, square at baseline, 2px surface gap.
- Gridlines: solid 1px hairlines, recessive. Never dashed.
- Legend present for ≥2 series; none for one series (title names it).
- Never a number on every point — label endpoint/extreme only.
- Every chart has hover tooltip (crosshair on lines, per-mark on bars) **and** keyboard focus.
- Every chart has a "View as table" toggle.
- Tooltip text via `textContent` (labels come from API/LLM output — untrusted).
- Dark mode uses the dark steps, not an auto-invert.
- Hero/stat numbers: proportional figures; `tabular-nums` only in table columns.

---

## 6. Component specs

**StatCard** (summary bar): label · value (count-up) · sub-line (% or caption) · optional
sparkline · click → navigates (Total/Fatal/Non-Fatal → `/audit?grade=…`, Risky →
`/audit?risky=1`, Root Causes → `/issues`, Prompt Version → `/history`).

**GradeBadge**: Fatal (critical + `XCircle`) / Non-Fatal (good + `CheckCircle`).

**RiskyFlags**: icon chips — frustration `Frown`, loop `Repeat`, asked for human
`UserRound`, low confidence `AudioWaveform`, wrong_capture `Target`. Tooltip with label.

**CallsTable** (Audit): virtualized (100s of rows), sticky header, sortable, row hover
lift, click → drawer. Columns per ui.md. Filters sidebar (grade, risky, category multi,
language, prompt version, ASR range slider) — filters sync to URL query params.

**CallDrawer**: metadata grid → verdict card → flags → transcript (BOT left /
USER right bubbles) → evidence turn highlighted yellow with "Why Fatal" tooltip →
ASR sparkline → "Original / With Fix" segmented toggle (when tested; repaired lines
green, still failing red) → root-cause badge link → "Replay with Current Prompt".

**RootCauseCard**: rank · name · type badge · frequency · severity · priority score
(info icon explains `freq × severity`, normalized) · example call chips · expand →
2–3 transcript snippets · Fixed/Unfixed badge · `View All Calls` / `Go to Fix →`.

**FixCard**: GitHub-style diff (`-` red bg, `+` green bg, mono font), expected repaired,
status badge, Approve / Reject / Edit (inline textarea). Multi-select checkbox →
sticky bottom bar "Approve 2 fixes → create Prompt v3". "Preview Full New Prompt" modal.

**TestCard**: before/after rates, animated delta bar, verdict badge, time-to-fix,
repaired / still failing / regressed (regressed red & prominent if >0),
`View Replayed Calls` → side-by-side old vs new bot response table.

**RegressionBanner**: critical-tinted, icon, names the root cause + new frequency, link.

**VersionTimeline**: vertical, newest top, animated connector line, each node expandable
to full diff; trend chart on top.

**UploadModal**: dropzone (animated dashed→solid border on drag-over, glow), file list
with name + duration, batch label input, Start Processing.

**NotificationBell**: badge count with pop animation; panel lists risky-call alerts and
"3 prompt fixes ready for review" style events, each deep-links.

---

## 7. API contract (Go backend)

The backend is written in Go by another teammate. Frontend types mirror its JSON
exactly — snake_case on the wire and in the client, no mapping layer. Base URL from `VITE_API_URL`.

**Source of truth:** `web/src/types/api.ts` (wire types) and the endpoint + SSE tables in
`web/README.md` (implemented by `web/src/api/http.ts`). The UI fetches full lists
(`/api/calls`, `/api/root-causes`, ...) and filters client-side; live updates arrive as SSE
events whose `event:` name is the type (`call.graded`, `batch.progress`, `root_causes.ready`,
`fixes.ready`, `prompt.created`, `test.done`, `regression`, `call.updated`, `batch.created`).
Change the contract in those files first, then tell the Go owner.

---

## 8. Mock mode (demo without backend)

`VITE_MOCK=1` (`npm run dev:mock`) swaps the API client for an in-browser mock (`web/src/api/mock/`) that:
- seeds ~100 realistic Hinglish IndiaMART calls (pipes, fabrics, machinery specs),
- on upload, streams `call.graded` events ~every 120ms (0→100) so the header,
  summary bar, and Audit table animate live,
- then emits `batch.stage: clustering` (2s) → root causes → `fixes.ready`,
- on approve, runs a fake replay (3s) and produces test results + Prompt v(n+1),
- a second upload can trigger a `regression` event.

The mock implements the **same interface** as the real client, so switching to the Go
API is a config change, not a refactor.

---

## 9. Quality bar / done checklist

- [ ] Every number and badge clicks through somewhere (no dead ends).
- [ ] Every call/fix/test shows a status badge (icon + label, never color alone).
- [ ] Light and dark both look intentional; theme toggle wins over OS setting.
- [ ] `prefers-reduced-motion` honored.
- [ ] Keyboard: tabs, table rows, drawer (Esc closes, focus trapped), modal, diff actions.
- [ ] Charts: one axis, hover + focus tooltips, table view, no clipped labels.
- [ ] No horizontal scroll at 375px width.
- [ ] LLM/API strings rendered as text (no `dangerouslySetInnerHTML`).
- [ ] Render it and look at it before calling a screen done.
