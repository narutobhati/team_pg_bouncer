import { AnimatePresence, motion } from "framer-motion";
import { AlertOctagon, ArrowRight, CheckCircle2, Clock, FlaskConical, Loader2, Repeat2, ShieldCheck, TriangleAlert, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { TestResult } from "@/types/api";
import { useFixes, usePipeline, useRegressions, useReplayed, useTests } from "@/api/hooks";
import { GradeBadge, VersionChip } from "@/components/Badges";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { EmptyState, SectionTitle, Stat } from "@/components/Misc";
import { Modal } from "@/components/Overlay";
import { DeltaBars } from "@/components/charts/DeltaBars";
import { cn, elapsed, pct } from "@/lib/util";
import { fadeUp, stagger } from "@/theme/motion";
import { useCallParam } from "../audit/useCallParam";

const rate = (n: number, d: number) => (d ? n / d : 0);

function Verdict({ v }: { v: TestResult["verdict"] }) {
  const ok = v === "Validated";
  return (
    <span className="chip text-t1" style={{ background: `color-mix(in srgb, var(${ok ? "--good" : "--serious"}) 15%, transparent)` }}>
      {ok ? <ShieldCheck size={13} style={{ color: "var(--good)" }} /> : <TriangleAlert size={13} style={{ color: "var(--serious)" }} />}
      {v}
    </span>
  );
}

function TestCard({ t, onView, focused }: { t: TestResult; onView: () => void; focused: boolean }) {
  const before = rate(t.before_fatal, t.replayed);
  const after = rate(t.after_fatal, t.replayed);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focused]);
  return (
    <motion.article ref={ref} layout variants={fadeUp} className={cn("card relative overflow-hidden p-5", focused && "shadow-glow")}>
      <span
        className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full opacity-40 blur-3xl"
        style={{ background: t.verdict === "Validated" ? "var(--good)" : "var(--serious)" }}
      />
      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-tm">Test</div>
          <h3 className="text-[15px] font-semibold text-t1">“{t.root_cause_name}”</h3>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-t2">
            <VersionChip v={t.prompt_before} /> <ArrowRight size={12} /> <VersionChip v={t.prompt_after} active />
          </div>
        </div>
        <Verdict v={t.verdict} />
      </div>

      <div className="relative mt-5 space-y-1">
        <DeltaBars before={before} after={after} beforeLabel={`Before (${t.prompt_before})`} afterLabel={`After (${t.prompt_after})`} />
        <div className="tnum flex justify-between pl-[104px] pr-[56px] pt-1 text-[11px] text-tm">
          <span>
            {t.before_fatal}/{t.replayed} → {t.after_fatal}/{t.replayed} fatal
          </span>
        </div>
      </div>

      <div className="relative mt-4 flex items-baseline gap-2">
        <span className="text-3xl font-semibold tracking-tight" style={{ color: after < before ? "var(--good-text)" : "var(--critical-text)" }}>
          <AnimatedNumber value={(after - before) * 100} format={(n) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(Math.round(n))}%`} duration={1.1} />
        </span>
        <span className="text-sm text-t2">fatal rate on replayed calls</span>
      </div>

      <div className="relative mt-4 grid grid-cols-2 gap-4 border-t border-line pt-4 sm:grid-cols-4">
        <Stat label="Replayed" value={t.replayed} />
        <Stat label="Repaired" value={t.repaired} tone="good" />
        <Stat label="Still failing" value={t.still_failing} tone={t.still_failing ? "warn" : undefined} />
        <Stat label="Regressed" value={t.regressed} tone={t.regressed ? "crit" : undefined} />
      </div>

      <div className="relative mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <span className="flex items-center gap-1.5 text-xs text-t2">
          <Clock size={13} /> Issue found → fix tested: <b className="text-t1">{elapsed(t.seconds_to_fix)}</b>
        </span>
        <button className="btn-outline ml-auto px-3 py-1.5 text-xs" onClick={onView}>
          <Repeat2 size={13} /> View replayed calls
        </button>
      </div>
    </motion.article>
  );
}

function ReplayedModal({ fixId, onClose, title }: { fixId: number | null; onClose: () => void; title: string }) {
  const { data: rows = [], isLoading } = useReplayed(fixId);
  const [, openCall] = useCallParam();
  return (
    <Modal open={fixId != null} onClose={onClose} title="Replayed calls" subtitle={title} className="max-w-5xl">
      {isLoading ? (
        <div className="grid place-items-center py-16">
          <Loader2 className="animate-spin text-accent" />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-tm">
                <th className="py-2 pr-3 font-medium">Call</th>
                <th className="py-2 pr-3 font-medium">Before → After</th>
                <th className="py-2 pr-3 font-medium">Old bot response</th>
                <th className="py-2 pr-3 font-medium">New bot response</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <motion.tr
                  key={r.call_id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.03, 0.6) }}
                  className="cursor-pointer border-b border-line align-top last:border-0 hover:bg-s2"
                  onClick={() => {
                    onClose();
                    openCall(r.call_id);
                  }}
                >
                  <td className="py-3 pr-3">
                    <div className="font-mono text-xs font-semibold text-t1">{r.call_code}</div>
                    <div className="mt-1 flex items-center gap-1 text-xs" style={{ color: r.status === "Repaired" ? "var(--good-text)" : "var(--critical-text)" }}>
                      {r.status === "Repaired" ? <CheckCircle2 size={12} /> : <XCircle size={12} />} {r.status}
                    </div>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="flex flex-wrap items-center gap-1">
                      <GradeBadge grade={r.before} /> <ArrowRight size={12} className="text-tm" /> <GradeBadge grade={r.after} />
                    </div>
                  </td>
                  <td className="max-w-[280px] py-3 pr-3">
                    <div className="rounded-lg px-2.5 py-1.5 text-xs text-t1" style={{ background: "var(--diff-del-bg)" }}>
                      {r.old_response}
                    </div>
                  </td>
                  <td className="max-w-[280px] py-3 pr-3">
                    <div className="rounded-lg px-2.5 py-1.5 text-xs text-t1" style={{ background: r.status === "Repaired" ? "var(--diff-add-bg)" : "var(--diff-del-bg)" }}>
                      {r.new_response}
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function RegressionBanner() {
  const { data: regs = [] } = useRegressions();
  const nav = useNavigate();
  return (
    <AnimatePresence>
      {regs.slice(0, 2).map((r) => (
        <motion.div
          key={r.id}
          initial={{ opacity: 0, y: -10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0 }}
          className="relative flex flex-wrap items-center gap-3 overflow-hidden rounded-2xl border px-4 py-3.5"
          style={{ borderColor: "color-mix(in srgb, var(--critical) 45%, transparent)", background: "color-mix(in srgb, var(--critical) 9%, var(--surface-1))" }}
          role="alert"
        >
          <motion.span
            className="absolute inset-y-0 left-0 w-1"
            style={{ background: "var(--critical)" }}
            animate={{ opacity: [1, 0.4, 1] }}
            transition={{ duration: 1.6, repeat: Infinity }}
          />
          <AlertOctagon size={18} style={{ color: "var(--critical)" }} />
          <div className="min-w-0 flex-1 text-sm">
            <span className="font-semibold text-t1">Regression: “{r.root_cause_name}”</span>
            <span className="text-t2">
              {" "}
              — fixed in {r.fixed_in}, but back at <b className="text-t1">{pct(r.frequency)}</b> in Batch #{r.batch_id} (threshold 5%).
            </span>
          </div>
          <button className="btn-outline px-3 py-1.5 text-xs" onClick={() => nav(`/issues`)}>
            Investigate
          </button>
        </motion.div>
      ))}
    </AnimatePresence>
  );
}

function TestingNow() {
  const { data: pipeline } = usePipeline();
  const { data: fixes = [] } = useFixes();
  const running = fixes.filter((f) => f.status === "Approved");
  return (
    <AnimatePresence>
      {pipeline?.stage === "testing" && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
          <div className="card relative overflow-hidden p-5">
            <span className="shimmer absolute inset-0 opacity-20" />
            <div className="relative flex items-center gap-4">
              <span className="relative grid h-11 w-11 place-items-center rounded-xl bg-accent-soft">
                <FlaskConical size={20} className="text-accent" />
                <motion.span className="absolute inset-0 rounded-xl border-2 border-accent" animate={{ scale: [1, 1.3], opacity: [0.6, 0] }} transition={{ duration: 1.4, repeat: Infinity }} />
              </span>
              <div>
                <div className="font-semibold text-t1">Replay simulation running</div>
                <div className="text-sm text-t2">
                  Re-running caller turns for {running.length} fix{running.length === 1 ? "" : "es"} against {pipeline.active_prompt}, then re-grading every simulated call…
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function TestPage() {
  const { data: tests = [] } = useTests();
  const { data: pipeline } = usePipeline();
  const [params] = useSearchParams();
  const focusFix = params.get("fix");
  const [view, setView] = useState<TestResult | null>(null);

  if (!tests.length && pipeline?.stage !== "testing")
    return (
      <div className="space-y-4">
        <RegressionBanner />
        <EmptyState icon={FlaskConical} title="No tests yet" body="Approve a prompt fix and the affected calls are replayed against the new prompt here." />
      </div>
    );

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <RegressionBanner />
        <TestingNow />
      </div>

      {tests.length > 0 && (
        <>
          <section>
            <SectionTitle title="Fix results" subtitle="Each approved fix replayed on the calls in its root cause" />
            <motion.div variants={stagger(0.08)} initial="hidden" animate="show" className="grid gap-4 lg:grid-cols-2">
              {tests.map((t) => (
                <TestCard key={`${t.fix_id}-${t.completed_at}`} t={t} onView={() => setView(t)} focused={focusFix === String(t.fix_id)} />
              ))}
            </motion.div>
          </section>

          <section>
            <SectionTitle title="Summary across fixes" />
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs text-tm">
                    {["Root cause", "Prompt", "Before", "After", "Delta", "Calls fixed", "Status"].map((h) => (
                      <th key={h} className="px-4 py-2.5 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tests.map((t) => {
                    const b = rate(t.before_fatal, t.replayed);
                    const a = rate(t.after_fatal, t.replayed);
                    return (
                      <tr key={`${t.fix_id}-${t.completed_at}`} className="cursor-pointer border-b border-line last:border-0 hover:bg-s2" onClick={() => setView(t)}>
                        <td className="px-4 py-3 font-medium text-t1">{t.root_cause_name}</td>
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-1">
                            <VersionChip v={t.prompt_before} /> <ArrowRight size={11} className="text-tm" /> <VersionChip v={t.prompt_after} />
                          </span>
                        </td>
                        <td className="tnum px-4 py-3 text-t2">{pct(b)}</td>
                        <td className="tnum px-4 py-3 text-t2">{pct(a)}</td>
                        <td className="tnum px-4 py-3 font-semibold" style={{ color: a < b ? "var(--good-text)" : "var(--critical-text)" }}>
                          {a < b ? "−" : "+"}
                          {pct(Math.abs(a - b))}
                        </td>
                        <td className="tnum px-4 py-3 text-t1">
                          {t.repaired}/{t.before_fatal}
                        </td>
                        <td className="px-4 py-3">
                          <Verdict v={t.verdict} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <ReplayedModal fixId={view?.fix_id ?? null} onClose={() => setView(null)} title={view ? `“${view.root_cause_name}” · ${view.prompt_before} → ${view.prompt_after}` : ""} />
    </div>
  );
}
