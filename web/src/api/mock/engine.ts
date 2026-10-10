// In-browser stand-in for the Go API. Runs the whole loop from workflow.md:
// transcribe → grade → cluster → suggest fixes → approve → replay test → new prompt → regression check.
import type { ApiClient, CreateBatchInput } from "../client";
import type {
  Batch,
  Call,
  Fix,
  Grade,
  Pipeline,
  PromptVersion,
  Regression,
  ReplayedCall,
  RiskFlag,
  RootCause,
  ServerEvent,
  TestResult,
  Turn,
} from "@/types/api";
import { createRng, type Rng } from "./rng";
import {
  BASE_PROMPT,
  SCENARIOS,
  SCENARIO_BY_KEY,
  addSeconds,
  buildClean,
  makeCtx,
  toTurns,
  type Built,
  type Ctx,
  type Scenario,
  type ScenarioKey,
} from "./scenarios";

interface CallMeta {
  scenario?: ScenarioKey;
  ctx: Ctx;
  built: Built;
  fatalLayout: boolean;
}

const LANGS = ["hi-IN", "hi-IN", "hi-IN", "hi-IN", "en-IN", "mr-IN", "gu-IN"];
const FRUSTRATION = ["nahi nahi", "galat", "phir se", "rehne do", "sun hi nahi"];
const LOW_CONF = 0.75;
const REGRESSION_THRESHOLD = 0.05;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clone = <T>(v: T): T => structuredClone(v);
const now = () => new Date().toISOString();

export class MockEngine implements ApiClient {
  readonly mode = "mock" as const;

  private listeners = new Set<(e: ServerEvent) => void>();
  private rng: Rng = createRng(20261009);
  private batches: Batch[] = [];
  private calls: Call[] = [];
  private meta = new Map<number, CallMeta>();
  private rootCauses: RootCause[] = [];
  private rcKey = new Map<number, ScenarioKey>();
  private fixes: Fix[] = [];
  private tests: TestResult[] = [];
  private replays = new Map<number, ReplayedCall[]>();
  private prompts: PromptVersion[] = [];
  private regressions: Regression[] = [];
  private fixedKeys = new Set<ScenarioKey>();
  private fixedIn = new Map<ScenarioKey, string>();
  private repairRatio = new Map<ScenarioKey, number>();
  private regressionSeeded = false;
  private pipeline: Pipeline = { stage: "idle", processed: 0, total: 0, active_prompt: "v1" };
  private seq = { call: 1, batch: 1, rc: 1, fix: 1, reg: 1 };

  constructor() {
    this.resetState();
  }

  private resetState() {
    this.rng = createRng(20261009);
    this.batches = [];
    this.calls = [];
    this.meta.clear();
    this.rootCauses = [];
    this.rcKey.clear();
    this.fixes = [];
    this.tests = [];
    this.replays.clear();
    this.regressions = [];
    this.fixedKeys.clear();
    this.fixedIn.clear();
    this.repairRatio.clear();
    this.regressionSeeded = false;
    this.seq = { call: 1, batch: 1, rc: 1, fix: 1, reg: 1 };
    this.pipeline = { stage: "idle", processed: 0, total: 0, active_prompt: "v1" };
    this.prompts = [
      {
        version: "v1",
        created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
        fixes_applied: [],
        fixed_root_causes: [],
        text: BASE_PROMPT,
        diff: BASE_PROMPT.split("\n").map((text) => ({ kind: "context" as const, text })),
        calls_applied: 0,
        batch_ids: [],
        active: true,
      },
    ];
  }

  // ---------- plumbing ----------

  private emit(e: ServerEvent) {
    this.listeners.forEach((fn) => fn(clone(e)));
  }

  private async latency<T>(value: T): Promise<T> {
    await wait(60 + Math.random() * 140);
    return clone(value);
  }

  private get active() {
    return this.prompts.find((p) => p.active)!;
  }

  private setStage(stage: Pipeline["stage"], patch: Partial<Pipeline> = {}) {
    this.pipeline = { ...this.pipeline, ...patch, stage };
    const batch = this.batches.find((b) => b.id === this.pipeline.batch_id);
    if (batch) batch.stage = stage;
    this.emit({ type: "batch.progress", pipeline: this.pipeline });
  }

  subscribe(handler: (e: ServerEvent) => void) {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  async reset() {
    this.resetState();
    this.emit({ type: "batch.progress", pipeline: this.pipeline });
  }

  // ---------- reads ----------

  getPipeline() {
    return this.latency(this.pipeline);
  }
  listBatches() {
    return this.latency(this.batches);
  }
  listCalls() {
    return this.latency(this.calls);
  }
  getCall(id: number) {
    const call = this.calls.find((c) => c.id === id);
    if (!call) return Promise.reject(new Error(`call ${id} not found`));
    return this.latency(call);
  }
  listRootCauses() {
    return this.latency(this.rootCauses);
  }
  listFixes() {
    return this.latency(this.fixes);
  }
  listTests() {
    return this.latency(this.tests);
  }
  listReplayedCalls(fixId: number) {
    return this.latency(this.replays.get(fixId) ?? []);
  }
  listRegressions() {
    return this.latency(this.regressions);
  }
  listPrompts() {
    const out = this.prompts.map((p) => {
      const calls = this.calls.filter((c) => c.prompt_version === p.version);
      const fatal = calls.filter((c) => c.grade === "Fatal").length;
      return {
        ...p,
        calls_applied: calls.length,
        batch_ids: this.batches.filter((b) => b.prompt_version === p.version).map((b) => b.id),
        fatal_rate: calls.length ? fatal / calls.length : undefined,
      };
    });
    return this.latency(out.reverse());
  }

  // ---------- live test (mock stubs — not functional in demo mode) ----------

  generateFix(_rcId: number): Promise<{ status: string; rc_id: number }> {
    return Promise.reject(new Error("Generate Fix is not available in demo mode."));
  }
  retestFix(_fixId: number): Promise<{ status: string; fix_id: number }> {
    return Promise.reject(new Error("Retest is not available in demo mode."));
  }
  startLiveTest(_fixId: number, _callId?: number): Promise<import("@/types/api").LiveSession> {
    return Promise.reject(new Error("Live Test is not available in demo mode. Connect to the backend."));
  }
  sendLiveTurn(_sessionId: string, _text: string): Promise<import("@/types/api").LiveTurnResponse> {
    return Promise.reject(new Error("Live Test is not available in demo mode."));
  }
  endLiveTest(_sessionId: string): Promise<import("@/types/api").LiveTestResult> {
    return Promise.reject(new Error("Live Test is not available in demo mode."));
  }

  // ---------- upload + pipeline ----------

  async createBatch({ files, label, sampleCount, entries }: CreateBatchInput): Promise<Batch> {
    if (["processing", "clustering", "fixing", "testing"].includes(this.pipeline.stage)) {
      throw new Error("Pipeline is busy — wait for the current batch to finish.");
    }
    const list =
      entries && entries.length
        ? entries
        : sampleCount
          ? Array.from({ length: sampleCount }, (_, i) => ({ name: `call_${String(i + 1).padStart(4, "0")}.wav`, size: 0 }))
          : files.map((f) => ({ name: f.name, size: f.size }));
    if (!list.length) throw new Error("No audio files found in the upload.");

    const batch: Batch = {
      id: this.seq.batch++,
      label: label || `Batch ${this.seq.batch - 1}`,
      total: list.length,
      processed: 0,
      prompt_version: this.active.version,
      stage: "queued",
      created_at: now(),
    };
    this.batches.push(batch);
    this.emit({ type: "batch.created", batch: clone(batch) });
    this.setStage("processing", { batch_id: batch.id, processed: 0, total: batch.total, active_prompt: batch.prompt_version });
    void this.runBatch(batch, list);
    return clone(batch);
  }

  private async runBatch(batch: Batch, list: { name: string; duration_sec?: number }[]) {
    const step = Math.min(160, Math.max(55, 9000 / list.length));
    const regressKey = this.pickRegressionKey();
    for (const file of list) {
      await wait(step * (0.6 + Math.random() * 0.8));
      const call = this.gradeCall(batch, file, regressKey);
      this.calls.push(call);
      batch.processed++;
      this.pipeline = { ...this.pipeline, processed: batch.processed };
      this.emit({ type: "call.graded", call: clone(call) });
      this.emit({ type: "batch.progress", pipeline: this.pipeline });
    }
    batch.completed_at = now();
    this.setStage("clustering");
    await wait(2200);
    this.cluster(batch);
    batch.clustered_at = now();
    this.emit({ type: "root_causes.ready", batch_id: batch.id, count: this.rootCauses.filter((r) => r.batch_id === batch.id).length });

    this.setStage("fixing");
    await wait(1600);
    const created = this.suggestFixes(batch);
    if (created) this.emit({ type: "fixes.ready", count: created });
    this.setStage("done");
  }

  /** On the first batch after a fix ships, let the weakest fix's failure partially return so the regression check has something to catch. */
  private pickRegressionKey(): ScenarioKey | undefined {
    if (this.regressionSeeded || !this.fixedKeys.size) return undefined;
    this.regressionSeeded = true;
    return [...this.fixedKeys].sort((a, b) => (this.repairRatio.get(a) ?? 1) - (this.repairRatio.get(b) ?? 1))[0];
  }

  private pickScenario(regressKey?: ScenarioKey): Scenario | undefined {
    const r = this.rng.next();
    let acc = 0;
    for (const s of SCENARIOS) {
      let w = s.weight;
      if (this.fixedKeys.has(s.key)) w = s.key === regressKey ? Math.max(s.weight * 0.75, 0.075) : s.weight * (1 - s.repairRate) * 0.5;
      acc += w;
      if (r < acc) return s;
    }
    return undefined;
  }

  private gradeCall(batch: Batch, file: { name: string; duration_sec?: number }, regressKey?: ScenarioKey): Call {
    const rng = this.rng;
    const ctx = makeCtx(rng);
    const scenario = this.pickScenario(regressKey);
    const fatal = scenario ? rng.chance(scenario.fatalRate) : false;
    const built = scenario ? scenario.build(ctx, fatal) : buildClean(ctx);
    const transcript = toTurns(built.lines, rng);

    // occasional low-confidence blip on otherwise clean calls
    if (!scenario && rng.chance(0.08)) {
      const u = transcript.findIndex((t) => t.speaker === "USER");
      if (u >= 0) transcript[u].confidence = +rng.range(0.62, 0.73).toFixed(2);
    }

    const id = this.seq.call++;
    this.meta.set(id, { scenario: scenario?.key, ctx, built, fatalLayout: fatal });
    const grade: Grade = fatal ? "Fatal" : "Non-Fatal";
    const reason = scenario
      ? rng.pick(fatal ? scenario.reasons.fatal : scenario.reasons.ok.length ? scenario.reasons.ok : scenario.reasons.fatal)
      : "Requirement captured and confirmed correctly";
    const last = transcript[transcript.length - 1];
    const [mm, ss] = last.timestamp.split(":").map(Number);
    const conf = transcript.reduce((s, t) => s + t.confidence, 0) / transcript.length;

    const call: Call = {
      id,
      call_id: `CL-${1000 + id}`,
      batch_id: batch.id,
      file_name: file.name,
      prompt_version: batch.prompt_version,
      created_at: now(),
      duration_sec: Math.round(file.duration_sec ?? mm * 60 + ss + rng.int(3, 9)),
      language: rng.pick(LANGS),
      overall_confidence: +conf.toFixed(2),
      grade,
      category: scenario?.category,
      reason,
      evidence: built.evidence,
      evidence_timestamp: transcript[built.evidenceIdx].timestamp,
      evidence_turn: built.evidenceIdx,
      risky_flags: [],
      reviewed: false,
      transcript,
    };
    call.risky_flags = this.detectRisk(call);
    return call;
  }

  /** Rule-based risky-flag pass (Stage 3, step 3 of workflow.md). */
  private detectRisk(call: Call): RiskFlag[] {
    const flags = new Set<RiskFlag>();
    const user = call.transcript.filter((t) => t.speaker === "USER");
    const userText = user.map((t) => t.text.toLowerCase()).join(" ");
    if (FRUSTRATION.some((k) => userText.includes(k))) flags.add("frustration");
    const botTexts = call.transcript.filter((t) => t.speaker === "BOT").map((t) => t.text);
    if (botTexts.some((t, i) => botTexts.indexOf(t) !== i)) flags.add("loop");
    if (/insaan|manager/.test(userText)) flags.add("human_request");
    if (user.some((t) => t.confidence < LOW_CONF)) flags.add("low_confidence");
    // wrong_capture only escalates a call that already shows a live risk signal
    if (flags.size && call.grade === "Fatal" && call.category === "wrong_capture") flags.add("wrong_capture");
    return [...flags];
  }

  // ---------- clustering ----------

  private cluster(batch: Batch) {
    const batchCalls = this.calls.filter((c) => c.batch_id === batch.id);
    const groups = new Map<ScenarioKey, Call[]>();
    for (const c of batchCalls) {
      const key = this.meta.get(c.id)?.scenario;
      if (!key) continue;
      groups.set(key, [...(groups.get(key) ?? []), c]);
    }

    const created: RootCause[] = [];
    for (const [key, members] of groups) {
      const fatal = members.filter((c) => c.grade === "Fatal");
      if (members.length < 2 || !fatal.length) continue;
      const s = SCENARIO_BY_KEY[key];
      const frequency = members.length / batchCalls.length;
      const severity = fatal.length / members.length;
      const id = this.seq.rc++;
      const wasFixed = this.fixedKeys.has(key);
      const rc: RootCause = {
        id,
        batch_id: batch.id,
        name: s.name,
        description: s.description,
        type: s.type,
        call_ids: members.map((c) => c.id),
        frequency,
        severity,
        priority_score: Math.round(100 * (1 - Math.exp(-14 * frequency * severity))),
        fixed: wasFixed,
        regressed: wasFixed && frequency > REGRESSION_THRESHOLD,
        snippets: fatal.slice(0, 3).map((c) => {
          const ev = c.evidence_turn ?? 0;
          return { call_id: c.id, lines: c.transcript.slice(Math.max(0, ev - 1), ev + 1) };
        }),
      };
      members.forEach((c) => (c.root_cause_id = id));
      this.rcKey.set(id, key);
      created.push(rc);

      if (rc.regressed) {
        const reg: Regression = {
          id: this.seq.reg++,
          root_cause_name: s.name,
          fixed_in: this.fixedIn.get(key) ?? "",
          batch_id: batch.id,
          frequency,
          created_at: now(),
        };
        this.regressions.unshift(reg);
        this.emit({ type: "regression", regression: clone(reg) });
      }
    }
    created.sort((a, b) => b.priority_score - a.priority_score);
    this.rootCauses.push(...created);
  }

  // ---------- fixes ----------

  private suggestFixes(batch: Batch): number {
    const pendingKeys = new Set(
      this.fixes.filter((f) => f.status === "Pending Review").map((f) => this.rcKey.get(f.root_cause_id)),
    );
    const candidates = this.rootCauses
      .filter((rc) => rc.batch_id === batch.id && !rc.fixed)
      .filter((rc) => !pendingKeys.has(this.rcKey.get(rc.id)))
      .sort((a, b) => b.priority_score - a.priority_score)
      .slice(0, 3);

    for (const rc of candidates) {
      const s = SCENARIO_BY_KEY[this.rcKey.get(rc.id)!];
      const fatalN = rc.call_ids.filter((id) => this.calls.find((c) => c.id === id)?.grade === "Fatal").length;
      this.fixes.push({
        id: this.seq.fix++,
        root_cause_id: rc.id,
        root_cause_name: rc.name,
        prompt_version: this.active.version,
        current_excerpt: s.fix.excerpt,
        proposed_change: s.fix.change,
        rationale: s.fix.rationale(fatalN),
        expected_calls_repaired: Math.max(1, Math.round(fatalN * s.repairRate)),
        affected_calls: rc.call_ids.length,
        priority_score: rc.priority_score,
        status: "Pending Review",
        created_at: now(),
      });
    }
    return candidates.length;
  }

  private applyFixes(ids: number[], edits: Record<number, string>) {
    const base = this.active.text.split("\n");
    const chosen = this.fixes.filter((f) => ids.includes(f.id));
    const diff: PromptVersion["diff"] = [];
    const lines = base.map((line) => {
      const fix = chosen.find((f) => f.current_excerpt.trim() === line.trim());
      if (!fix) {
        diff.push({ kind: "context", text: line });
        return line;
      }
      const next = (edits[fix.id] ?? fix.proposed_change).trim();
      diff.push({ kind: "remove", text: line }, { kind: "add", text: next });
      return next;
    });
    return { text: lines.join("\n"), diff };
  }

  async previewPrompt(ids: number[], edits: Record<number, string>) {
    return this.latency(this.applyFixes(ids, edits));
  }

  async rejectFix(id: number) {
    const fix = this.fixes.find((f) => f.id === id);
    if (!fix) throw new Error("fix not found");
    fix.status = "Rejected";
    return this.latency(fix);
  }

  async approveFixes(ids: number[], edits: Record<number, string>): Promise<PromptVersion> {
    const chosen = this.fixes.filter((f) => ids.includes(f.id) && f.status === "Pending Review");
    if (!chosen.length) throw new Error("No pending fixes selected.");
    const from = this.active;
    const { text, diff } = this.applyFixes(
      chosen.map((f) => f.id),
      edits,
    );
    const version = `v${this.prompts.length + 1}`;
    from.active = false;
    const pv: PromptVersion = {
      version,
      created_at: now(),
      based_on: from.version,
      fixes_applied: chosen.map((f) => f.id),
      fixed_root_causes: chosen.map((f) => f.root_cause_name),
      text,
      diff,
      calls_applied: 0,
      batch_ids: [],
      active: true,
    };
    this.prompts.push(pv);

    for (const f of chosen) {
      if (edits[f.id]) f.proposed_change = edits[f.id];
      f.status = "Approved";
      f.applied_in = version;
      const key = this.rcKey.get(f.root_cause_id)!;
      this.fixedKeys.add(key);
      this.fixedIn.set(key, version);
      // mark every root cause of this kind as fixed
      this.rootCauses.forEach((rc) => {
        if (this.rcKey.get(rc.id) === key) {
          rc.fixed = true;
          rc.fix_id = f.id;
        }
      });
    }
    this.pipeline.active_prompt = version;
    this.emit({ type: "prompt.created", version });

    // Only take over the status chip when no batch is mid-flight; otherwise the replay runs quietly.
    const ownsStage = this.pipeline.stage === "idle" || this.pipeline.stage === "done";
    if (ownsStage) this.setStage("testing");
    void wait(2800).then(() => {
      const results = chosen.map((f) => this.runReplay(f, from.version, version));
      this.tests.unshift(...results);
      const latest = this.batches[this.batches.length - 1];
      if (latest) {
        const batchCalls = this.calls.filter((c) => c.batch_id === latest.id);
        const fatal = batchCalls.filter((c) => (c.simulated_grade ?? c.grade) === "Fatal").length;
        pv.projected_fatal_rate = batchCalls.length ? fatal / batchCalls.length : undefined;
      }
      this.emit({ type: "test.done", results: clone(results) });
      if (ownsStage) this.setStage("done");
    });
    return clone(pv);
  }

  /** Stage 7: replay the USER turns of every call in the root cause against the new prompt, then re-grade. */
  private runReplay(fix: Fix, before: string, after: string): TestResult {
    const rc = this.rootCauses.find((r) => r.id === fix.root_cause_id)!;
    const key = this.rcKey.get(rc.id)!;
    const s = SCENARIO_BY_KEY[key];
    const rows: ReplayedCall[] = [];
    let beforeFatal = 0;
    let repaired = 0;
    let still = 0;

    for (const id of rc.call_ids) {
      const call = this.calls.find((c) => c.id === id)!;
      const m = this.meta.get(id)!;
      if (call.grade !== "Fatal" || !m.fatalLayout) continue;
      beforeFatal++;
      const ok = this.rng.chance(s.repairRate);
      const sim = this.simulate(call, s, m, ok);
      call.simulated_transcript = sim;
      call.simulated_grade = ok ? "Non-Fatal" : "Fatal";
      ok ? repaired++ : still++;
      const ev = call.evidence_turn ?? 0;
      rows.push({
        call_id: call.id,
        call_code: call.call_id,
        before: "Fatal",
        after: call.simulated_grade,
        status: ok ? "Repaired" : "Still Failing",
        old_response: call.transcript[ev]?.text ?? "",
        new_response: sim.find((t) => t.replay_status && t.replay_status !== "unchanged" && t.speaker === "BOT")?.text ?? call.transcript[ev]?.text ?? "",
      });
    }
    // Non-fatal members replay unchanged; they count toward the denominator but cannot regress here.
    const replayed = rc.call_ids.length;
    const ratio = beforeFatal ? repaired / beforeFatal : 1;
    this.repairRatio.set(key, ratio);
    const verdict = ratio >= 0.7 ? "Validated" : "Needs Revision";
    fix.status = verdict;
    const batch = this.batches.find((b) => b.id === rc.batch_id);
    const found = batch?.clustered_at ? new Date(batch.clustered_at).getTime() : Date.now();
    this.replays.set(fix.id, rows);
    return {
      fix_id: fix.id,
      root_cause_id: rc.id,
      root_cause_name: rc.name,
      prompt_before: before,
      prompt_after: after,
      replayed,
      before_fatal: beforeFatal,
      after_fatal: still,
      repaired,
      still_failing: still,
      regressed: 0,
      seconds_to_fix: Math.max(1, Math.round((Date.now() - found) / 1000)),
      verdict,
      completed_at: now(),
    };
  }

  private simulate(call: Call, s: Scenario, m: CallMeta, repaired: boolean): Turn[] {
    const replace = s.fix.replace(m.ctx);
    const ev = call.evidence_turn ?? 0;
    const out: Turn[] = [];
    call.transcript.forEach((t, i) => {
      if (repaired && s.fix.drop?.includes(i)) return;
      if (replace[i] !== undefined && t.speaker === "BOT") {
        out.push(
          repaired
            ? { ...t, text: replace[i], original_text: t.text, replay_status: "repaired" }
            : { ...t, original_text: t.text, replay_status: i === ev ? "failing" : "unchanged" },
        );
      } else {
        out.push({ ...t, replay_status: !repaired && i === ev ? "failing" : "unchanged" });
      }
    });
    if (repaired && s.fix.append) {
      const last = out[out.length - 1];
      out.push({
        speaker: "BOT",
        text: s.fix.append(m.ctx),
        timestamp: addSeconds(last.timestamp, 5),
        confidence: 0.96,
        replay_status: "repaired",
      });
    }
    return out;
  }

  async replayCall(id: number) {
    const call = this.calls.find((c) => c.id === id);
    if (!call) throw new Error("call not found");
    await wait(1400);
    const m = this.meta.get(id)!;
    if (!call.simulated_transcript) {
      if (m.scenario && this.fixedKeys.has(m.scenario) && call.grade === "Fatal" && m.fatalLayout) {
        const s = SCENARIO_BY_KEY[m.scenario];
        const ok = this.rng.chance(s.repairRate);
        call.simulated_transcript = this.simulate(call, s, m, ok);
        call.simulated_grade = ok ? "Non-Fatal" : "Fatal";
      } else {
        call.simulated_transcript = call.transcript.map((t) => ({ ...t, replay_status: "unchanged" as const }));
        call.simulated_grade = call.grade;
      }
      this.emit({ type: "call.updated", call: clone(call) });
    }
    return clone({ transcript: call.simulated_transcript!, grade: call.simulated_grade! });
  }

  async markReviewed(id: number) {
    const call = this.calls.find((c) => c.id === id);
    if (!call) throw new Error("call not found");
    call.reviewed = !call.reviewed;
    this.emit({ type: "call.updated", call: clone(call) });
    return this.latency(call);
  }

  async verifyCall(id: number) {
    const call = this.calls.find((c) => c.id === id);
    if (!call) throw new Error("call not found");
    call.verified = true;
    this.emit({ type: "call.updated", call: clone(call) });
    return this.latency(call);
  }

  async rerunCall(id: number) {
    const call = this.calls.find((c) => c.id === id);
    if (!call) throw new Error("call not found");
    call.verified = false;
    call.audio_hash = undefined;
    this.emit({ type: "call.updated", call: clone(call) });
    return this.latency(call);
  }
}
