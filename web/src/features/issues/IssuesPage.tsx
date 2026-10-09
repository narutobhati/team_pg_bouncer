import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { AlertOctagon, ArrowRight, Bot, ChevronDown, Info, Layers, ListFilter, ShieldCheck, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { Call, RootCause } from "@/types/api";
import { ROOT_CAUSE_TYPES } from "@/types/api";
import { useCalls, useFixes, usePrompts, useScopedCalls, useScopedRootCauses } from "@/api/hooks";
import { TypeBadge, typeColor } from "@/components/Badges";
import { EmptyState, SectionTitle, Segmented } from "@/components/Misc";
import { Tooltip } from "@/components/Tooltip";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { ChartCard, LegendItem } from "@/components/charts/ChartCard";
import { BarList } from "@/components/charts/BarList";
import { Donut } from "@/components/charts/Donut";
import { TrendLine, type TrendPoint } from "@/components/charts/TrendLine";
import { cn, pct } from "@/lib/util";
import { fadeUp, stagger } from "@/theme/motion";
import { useCallParam } from "../audit/useCallParam";

export function useTrend(): TrendPoint[] {
  const { data: prompts = [] } = usePrompts();
  return prompts
    .slice()
    .reverse()
    .filter((p) => p.fatal_rate != null || p.projected_fatal_rate != null)
    .map((p) => ({
      x: p.version,
      y: (p.fatal_rate ?? p.projected_fatal_rate)!,
      projected: p.fatal_rate == null,
      note: p.fatal_rate != null ? `${p.calls_applied} calls` : undefined,
    }));
}

function ChartsRow({ rcs, calls }: { rcs: RootCause[]; calls: Call[] }) {
  const nav = useNavigate();
  const trend = useTrend();
  const fatal = calls.filter((c) => c.grade === "Fatal").length;
  return (
    <motion.div variants={stagger(0.08)} initial="hidden" animate="show" className="grid gap-4 lg:grid-cols-[1.4fr_1fr_1.2fr]">
      <motion.div variants={fadeUp}>
        <ChartCard
          className="h-full"
          title="Calls affected by root cause"
          subtitle="Click a bar to see its calls"
          table={{ columns: ["Root cause", "Type", "Calls", "Severity"], rows: rcs.map((r) => [r.name, r.type, r.call_ids.length, pct(r.severity)]) }}
        >
          <BarList
            data={rcs
              .slice()
              .sort((a, b) => b.call_ids.length - a.call_ids.length)
              .slice(0, 7)
              .map((r) => ({
              key: r.id,
              label: r.name,
              value: r.call_ids.length,
              sub: pct(r.severity) + " fatal",
              onClick: () => nav(`/audit?rc=${r.id}`),
            }))}
          />
        </ChartCard>
      </motion.div>
      <motion.div variants={fadeUp}>
        <ChartCard
          className="h-full"
          title="Fatal / Non-Fatal split"
          subtitle={`${calls.length} calls in scope`}
          table={{ columns: ["Grade", "Calls", "Share"], rows: [["Fatal", fatal, pct(fatal / (calls.length || 1))], ["Non-Fatal", calls.length - fatal, pct((calls.length - fatal) / (calls.length || 1))]] }}
          legend={
            <>
              <LegendItem color="var(--critical)" label={`Fatal · ${fatal}`} />
              <LegendItem color="var(--good)" label={`Non-Fatal · ${calls.length - fatal}`} />
            </>
          }
        >
          <div className="flex h-full items-center justify-center py-2">
            <Donut
              data={[
                { key: "f", label: "Fatal", value: fatal, color: "var(--critical)", onClick: () => nav("/audit?grade=Fatal") },
                { key: "n", label: "Non-Fatal", value: calls.length - fatal, color: "var(--good)", onClick: () => nav("/audit?grade=Non-Fatal") },
              ]}
              center={{ value: pct(fatal / (calls.length || 1)), label: "fatal rate" }}
            />
          </div>
        </ChartCard>
      </motion.div>
      <motion.div variants={fadeUp}>
        <ChartCard
          className="h-full"
          title="Fatal rate over prompt versions"
          subtitle="Hollow points are projected from replay tests"
          table={{ columns: ["Prompt", "Fatal rate", "Source"], rows: trend.map((t) => [t.x, pct(t.y), t.projected ? "replay projection" : "measured"]) }}
        >
          {trend.length ? <TrendLine data={trend} /> : <p className="py-16 text-center text-sm text-tm">Needs one graded batch.</p>}
        </ChartCard>
      </motion.div>
    </motion.div>
  );
}

function PriorityInfo() {
  return (
    <Tooltip
      wide
      content={
        <span className="block font-normal leading-relaxed">
          <b>Priority = 100 × (1 − e<sup>−14 × freq × severity</sup>)</b>
          <br />
          freq = share of the batch in this cluster; severity = share of those calls graded Fatal. Saturates near 100 so the top issues stay comparable.
        </span>
      }
    >
      <Info size={13} className="cursor-help text-tm" tabIndex={0} aria-label="How priority is computed" />
    </Tooltip>
  );
}

function StatusBadge({ rc, fixStatus }: { rc: RootCause; fixStatus?: string }) {
  if (rc.regressed)
    return (
      <span className="chip text-t1" style={{ background: "color-mix(in srgb, var(--critical) 14%, transparent)" }}>
        <AlertOctagon size={12} style={{ color: "var(--critical)" }} /> Regressed
      </span>
    );
  if (rc.fixed)
    return (
      <span className="chip text-t1" style={{ background: "color-mix(in srgb, var(--good) 14%, transparent)" }}>
        <ShieldCheck size={12} style={{ color: "var(--good)" }} /> Fixed
      </span>
    );
  return <span className="chip bg-s2 text-t2">{fixStatus === "Pending Review" ? "Fix pending" : "Unfixed"}</span>;
}

function RootCauseCard({ rc, rank, calls, focused }: { rc: RootCause; rank: number; calls: Map<number, Call>; focused: boolean }) {
  const [open, setOpen] = useState(focused);
  const nav = useNavigate();
  const [, openCall] = useCallParam();
  const { data: fixes = [] } = useFixes();
  const fix = fixes.find((f) => f.root_cause_id === rc.id);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focused]);
  const examples = rc.call_ids.slice(0, 3);

  return (
    <motion.article
      ref={ref}
      layout
      variants={fadeUp}
      className={cn("card relative overflow-hidden", focused && "shadow-glow")}
    >
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: typeColor(rc.type) }} />
      <div className="p-5 pl-6">
        <div className="flex flex-wrap items-start gap-3">
          <span className="tnum grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-s2 text-sm font-semibold text-t1">#{rank}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[15px] font-semibold text-t1">{rc.name}</h3>
              <TypeBadge type={rc.type} />
              <StatusBadge rc={rc} fixStatus={fix?.status} />
            </div>
            <p className="mt-1 text-sm text-t2">{rc.description}</p>
          </div>
          <div className="text-right">
            <div className="flex items-center justify-end gap-1 text-xs text-tm">
              Priority <PriorityInfo />
            </div>
            <div className="text-3xl font-semibold tracking-tight text-t1">
              <AnimatedNumber value={rc.priority_score} />
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-4 sm:grid-cols-4">
          <div>
            <div className="label">Frequency</div>
            <div className="mt-1 text-sm font-semibold text-t1">
              {rc.call_ids.length} calls <span className="font-normal text-tm">({pct(rc.frequency)})</span>
            </div>
          </div>
          <div>
            <div className="label">Severity</div>
            <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-t1">
              {pct(rc.severity)} Fatal
              <span className="h-1 w-12 overflow-hidden rounded-full" style={{ background: "color-mix(in srgb, var(--critical) 18%, transparent)" }}>
                <motion.span className="block h-full rounded-full" style={{ background: "var(--critical)" }} initial={{ width: 0 }} animate={{ width: `${rc.severity * 100}%` }} transition={{ duration: 0.8, delay: 0.2 }} />
              </span>
            </div>
          </div>
          <div className="col-span-2">
            <div className="label">Example calls</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {examples.map((id) => (
                <button key={id} onClick={() => openCall(id)} className="chip bg-s2 font-mono text-[11px] text-t1 transition-colors hover:bg-accent-soft hover:text-accent">
                  {calls.get(id)?.call_id ?? `#${id}`}
                </button>
              ))}
              {rc.call_ids.length > 3 && (
                <button onClick={() => nav(`/audit?rc=${rc.id}`)} className="text-xs text-t2 hover:text-t1">
                  +{rc.call_ids.length - 3} more
                </button>
              )}
            </div>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {open && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3 }} className="overflow-hidden">
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {rc.snippets.map((s) => (
                  <button key={s.call_id} onClick={() => openCall(s.call_id)} className="rounded-xl border border-line bg-s2 p-3 text-left text-xs transition-colors hover:border-accent">
                    <div className="mb-2 font-mono text-[11px] text-tm">{calls.get(s.call_id)?.call_id}</div>
                    {s.lines.map((l, i) => (
                      <div key={i} className="mb-1.5 flex gap-1.5 last:mb-0">
                        {l.speaker === "BOT" ? <Bot size={12} className="mt-0.5 shrink-0 text-accent" /> : <User size={12} className="mt-0.5 shrink-0 text-tm" />}
                        <span className={cn("text-t1", i === s.lines.length - 1 && "rounded px-1")} style={i === s.lines.length - 1 ? { background: "var(--evidence-bg)" } : undefined}>
                          {l.text}
                        </span>
                      </div>
                    ))}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => setOpen(!open)} aria-expanded={open}>
            <motion.span animate={{ rotate: open ? 180 : 0 }}>
              <ChevronDown size={14} />
            </motion.span>
            {open ? "Hide evidence" : "Show evidence"}
          </button>
          <button className="btn-outline px-3 py-1.5 text-xs" onClick={() => nav(`/audit?rc=${rc.id}`)}>
            <ListFilter size={13} /> View all calls
          </button>
          {fix && (
            <button className="btn-primary ml-auto px-3 py-1.5 text-xs" onClick={() => nav(`/fix?fix=${fix.id}`)}>
              Go to fix <ArrowRight size={13} />
            </button>
          )}
        </div>
      </div>
    </motion.article>
  );
}

export function IssuesPage() {
  const rcs = useScopedRootCauses();
  const scopedCalls = useScopedCalls();
  const { data: allCalls = [] } = useCalls();
  const [params] = useSearchParams();
  const focus = params.get("rc");
  const [type, setType] = useState<"all" | RootCause["type"]>("all");
  const callMap = new Map(allCalls.map((c) => [c.id, c]));
  const shown = type === "all" ? rcs : rcs.filter((r) => r.type === type);

  if (!rcs.length)
    return <EmptyState icon={Layers} title="No root causes yet" body="Root causes appear once every call in a batch has been graded and the failures are clustered." />;

  return (
    <div className="space-y-8">
      <ChartsRow rcs={rcs} calls={scopedCalls} />
      <section>
        <SectionTitle
          title="Root causes"
          subtitle="Ranked by priority score — frequency × severity"
          right={
            <Segmented
              size="sm"
              layoutId="rc-type"
              value={type}
              onChange={setType}
              options={[{ value: "all" as const, label: "All" }, ...ROOT_CAUSE_TYPES.map((t) => ({ value: t, label: <><span className="h-2 w-2 rounded-full" style={{ background: typeColor(t) }} />{t.replace(" Issue", "")}</> }))]}
            />
          }
        />
        <LayoutGroup>
          <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-4">
            {shown.map((rc) => (
              <RootCauseCard key={rc.id} rc={rc} rank={rcs.indexOf(rc) + 1} calls={callMap} focused={focus === String(rc.id)} />
            ))}
          </motion.div>
        </LayoutGroup>
      </section>
    </div>
  );
}
