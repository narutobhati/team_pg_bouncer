import { motion, useAnimationControls } from "framer-motion";
import { AlertTriangle, CheckCircle2, GitBranch, Layers, PhoneCall, XCircle, type LucideIcon } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useBatches, usePipeline, useScopedCalls, useScopedRootCauses } from "@/api/hooks";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { useUi } from "@/store/ui";
import { cn, pct } from "@/lib/util";
import { fadeUp, stagger } from "@/theme/motion";

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  color,
  onClick,
  meter,
  children,
}: {
  label: string;
  value: number | string;
  sub: ReactNode;
  icon: LucideIcon;
  color: string;
  onClick: () => void;
  meter?: number;
  children?: ReactNode;
}) {
  const controls = useAnimationControls();
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current !== value) {
      controls.start({ opacity: [0.55, 0], scale: [1, 1.04], transition: { duration: 0.7 } });
      prev.current = value;
    }
  }, [value, controls]);

  return (
    <motion.button
      variants={fadeUp}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="card group relative flex min-w-[150px] snap-start flex-col justify-start overflow-hidden p-4 text-left transition-shadow hover:shadow-glow"
    >
      <motion.span className="pointer-events-none absolute inset-0 rounded-2xl" style={{ boxShadow: `inset 0 0 0 1.5px ${color}` }} initial={{ opacity: 0 }} animate={controls} />
      <span
        className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-60"
        style={{ background: color }}
      />
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-t2">{label}</span>
        <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
          <Icon size={14} style={{ color }} strokeWidth={2.2} />
        </span>
      </div>
      <div className="mt-2 text-[28px] font-semibold leading-none tracking-tight text-t1">
        {typeof value === "number" ? <AnimatedNumber value={value} /> : value}
      </div>
      <div className="mt-1.5 truncate text-xs text-tm">{sub}</div>
      {meter != null && (
        <div className="mt-3 h-1 overflow-hidden rounded-full" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)` }}>
          <motion.div className="h-full rounded-full" style={{ background: color }} animate={{ width: `${Math.min(1, meter) * 100}%` }} transition={{ duration: 0.6 }} />
        </div>
      )}
      {children}
    </motion.button>
  );
}

function ScopeSelect() {
  const { scope, setScope } = useUi();
  const { data: batches = [] } = useBatches();
  if (batches.length < 2) return null;
  return (
    <label className="flex items-center gap-2 text-xs text-t2">
      <span className="hidden sm:inline">Showing</span>
      <select
        value={String(scope)}
        onChange={(e) => {
          const v = e.target.value;
          setScope(v === "latest" || v === "all" ? v : Number(v));
        }}
        className="rounded-lg border border-line bg-s1 px-2 py-1 text-xs text-t1 focus:border-accent focus:outline-none"
      >
        <option value="latest">Latest batch</option>
        <option value="all">All batches</option>
        {batches
          .slice()
          .reverse()
          .map((b) => (
            <option key={b.id} value={b.id}>
              Batch #{b.id} · {b.prompt_version}
            </option>
          ))}
      </select>
    </label>
  );
}

export function SummaryBar() {
  const calls = useScopedCalls();
  const rcs = useScopedRootCauses();
  const { data: pipeline } = usePipeline();
  const nav = useNavigate();
  const total = calls.length;
  const fatal = calls.filter((c) => c.grade === "Fatal").length;
  const risky = calls.filter((c) => c.risky_flags.length > 0);
  const pending = risky.filter((c) => !c.reviewed).length;

  return (
    <div className="relative">
      <div className="mb-2 flex items-center justify-end">
        <ScopeSelect />
      </div>
      <motion.div
        variants={stagger(0.05)}
        initial="hidden"
        animate="show"
        className={cn(
          "-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0",
          "sm:grid sm:grid-cols-3 sm:overflow-visible lg:grid-cols-6",
        )}
      >
        <StatCard label="Total calls" value={total} sub={pipeline?.stage === "processing" ? "grading live…" : "graded"} icon={PhoneCall} color="var(--accent)" onClick={() => nav("/audit")} />
        <StatCard label="Fatal" value={fatal} sub={`${pct(total ? fatal / total : undefined)} of calls`} icon={XCircle} color="var(--critical)" meter={total ? fatal / total : 0} onClick={() => nav("/audit?grade=Fatal")} />
        <StatCard label="Non-Fatal" value={total - fatal} sub={`${pct(total ? (total - fatal) / total : undefined)} of calls`} icon={CheckCircle2} color="var(--good)" meter={total ? (total - fatal) / total : 0} onClick={() => nav("/audit?grade=Non-Fatal")} />
        <StatCard label="Risky" value={risky.length} sub={risky.length ? `${pending} pending review` : "flagged"} icon={AlertTriangle} color="var(--warning)" onClick={() => nav("/audit?risky=1")} />
        <StatCard label="Root causes" value={rcs.length} sub={rcs.length ? `top: ${rcs[0].name}` : "found after clustering"} icon={Layers} color="var(--type-knowledge)" onClick={() => nav("/issues")} />
        <StatCard label="Prompt version" value={pipeline?.active_prompt ?? "v1"} sub="active" icon={GitBranch} color="var(--accent-2)" onClick={() => nav("/history")} />
      </motion.div>
    </div>
  );
}
