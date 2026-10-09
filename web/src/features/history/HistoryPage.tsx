import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, ChevronDown, GitCommitVertical, ListFilter, TrendingDown, TrendingUp } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PromptVersion } from "@/types/api";
import { usePrompts } from "@/api/hooks";
import { VersionChip } from "@/components/Badges";
import { Diff } from "@/components/Diff";
import { SectionTitle } from "@/components/Misc";
import { ChartCard } from "@/components/charts/ChartCard";
import { TrendLine } from "@/components/charts/TrendLine";
import { dateTime, pct } from "@/lib/util";
import { ease, fadeUp, stagger } from "@/theme/motion";
import { useTrend } from "../issues/IssuesPage";

const rateOf = (p?: PromptVersion) => p?.fatal_rate ?? p?.projected_fatal_rate;

function VersionNode({ p, prev, last }: { p: PromptVersion; prev?: PromptVersion; last: boolean }) {
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const baseline = !p.based_on;
  const r = rateOf(p);
  const pr = rateOf(prev);
  const dropped = r != null && pr != null ? r < pr : null;

  return (
    <motion.li variants={fadeUp} className="relative pl-10">
      {!last && (
        <motion.span
          className="absolute left-[15px] top-9 w-[2px] origin-top rounded-full bg-[color:var(--border-strong)]"
          style={{ bottom: -8 }}
          initial={{ scaleY: 0 }}
          animate={{ scaleY: 1 }}
          transition={{ duration: 0.6, ease, delay: 0.2 }}
        />
      )}
      <span
        className="absolute left-0 top-1 grid h-8 w-8 place-items-center rounded-full border-2"
        style={{
          borderColor: p.active ? "var(--accent)" : "var(--border-strong)",
          background: p.active ? "var(--accent-soft)" : "var(--surface-1)",
          boxShadow: p.active ? "var(--shadow-glow)" : undefined,
        }}
      >
        <GitCommitVertical size={15} className={p.active ? "text-accent" : "text-tm"} />
      </span>

      <div className="card mb-5 p-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h3 className="text-base font-semibold text-t1">Prompt {p.version}</h3>
          {p.active && <VersionChip v="active" active />}
          <span className="text-sm text-tm">— {baseline ? "Baseline (original)" : dateTime(p.created_at)}</span>
          {p.based_on && (
            <span className="ml-auto flex items-center gap-1 text-xs text-tm">
              based on <VersionChip v={p.based_on} />
            </span>
          )}
        </div>

        {p.fixed_root_causes.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-sm">
            <span className="text-tm">Fixed:</span>
            {p.fixed_root_causes.map((n) => (
              <span key={n} className="chip bg-s2 text-t1">
                {n}
              </span>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          {r != null && (
            <span className="flex items-center gap-2">
              <span className="text-tm">{baseline ? "Fatal rate" : "Fatal rate"}</span>
              {pr != null && !baseline && (
                <>
                  <span className="tnum text-t2">{pct(pr)}</span>
                  <ArrowRight size={13} className="text-tm" />
                </>
              )}
              <span className="tnum font-semibold" style={{ color: dropped === true ? "var(--good-text)" : dropped === false ? "var(--critical-text)" : "var(--text-1)" }}>
                {pct(r)}
              </span>
              {dropped != null && (dropped ? <TrendingDown size={14} style={{ color: "var(--good)" }} /> : <TrendingUp size={14} style={{ color: "var(--critical)" }} />)}
              {p.fatal_rate == null && <span className="chip bg-s2 text-tm">projected</span>}
            </span>
          )}
          <span className="text-t2">
            Applied to <b className="tnum text-t1">{p.calls_applied}</b> calls
            {p.batch_ids.length > 0 && <> in batch {p.batch_ids.map((b) => `#${b}`).join(", ")}</>}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn-outline px-3 py-1.5 text-xs" onClick={() => setOpen(!open)} aria-expanded={open}>
            <motion.span animate={{ rotate: open ? 180 : 0 }}>
              <ChevronDown size={13} />
            </motion.span>
            {baseline ? "View original prompt" : "View full diff"}
          </button>
          {p.calls_applied > 0 && (
            <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => nav(`/audit?prompt=${p.version}`)}>
              <ListFilter size={13} /> View calls from this version
            </button>
          )}
        </div>

        <AnimatePresence initial={false}>
          {open && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="pt-4">
                <Diff lines={p.diff} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.li>
  );
}

export function HistoryPage() {
  const { data: prompts = [] } = usePrompts();
  const trend = useTrend();

  return (
    <div className="space-y-8">
      <ChartCard
        title="Fatal rate across prompt versions"
        subtitle="Measured on batches run against each version; hollow points are projections from replay tests"
        table={{ columns: ["Prompt", "Fatal rate", "Source"], rows: trend.map((t) => [t.x, pct(t.y), t.projected ? "replay projection" : "measured"]) }}
      >
        {trend.length ? <TrendLine data={trend} height={220} /> : <p className="py-16 text-center text-sm text-tm">The trend appears after the first batch is graded.</p>}
      </ChartCard>

      <section>
        <SectionTitle title="Version timeline" subtitle="Newest first — every change, what it fixed, and what it did to the fatal rate" />
        <motion.ol variants={stagger(0.08)} initial="hidden" animate="show">
          {prompts.map((p, i) => (
            <VersionNode key={p.version} p={p} prev={prompts.find((x) => x.version === p.based_on)} last={i === prompts.length - 1} />
          ))}
        </motion.ol>
      </section>
    </div>
  );
}
