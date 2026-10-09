import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, CircleDot, FlaskConical, Loader2, Network, Sparkles } from "lucide-react";
import type { Pipeline } from "@/types/api";
import { cn } from "@/lib/util";

const META: Record<Pipeline["stage"], { label: string; icon: typeof CircleDot; color: string }> = {
  idle: { label: "Idle", icon: CircleDot, color: "var(--text-muted)" },
  queued: { label: "Queued", icon: Loader2, color: "var(--accent)" },
  processing: { label: "Processing", icon: Loader2, color: "var(--accent)" },
  clustering: { label: "Clustering…", icon: Network, color: "var(--type-knowledge)" },
  fixing: { label: "Drafting fixes…", icon: Sparkles, color: "var(--accent)" },
  testing: { label: "Replay testing…", icon: FlaskConical, color: "var(--accent-2)" },
  done: { label: "Done", icon: CheckCircle2, color: "var(--good)" },
};

function Ring({ value, color }: { value: number; color: string }) {
  const r = 8;
  const C = 2 * Math.PI * r;
  return (
    <svg width={20} height={20} viewBox="0 0 20 20" className="-rotate-90">
      <circle cx={10} cy={10} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={2.5} />
      <motion.circle
        cx={10}
        cy={10}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray={C}
        animate={{ strokeDashoffset: C * (1 - value) }}
        transition={{ duration: 0.35 }}
      />
    </svg>
  );
}

export function PipelineChip({ pipeline }: { pipeline?: Pipeline }) {
  const stage = pipeline?.stage ?? "idle";
  const m = META[stage];
  const busy = ["processing", "clustering", "fixing", "testing", "queued"].includes(stage);
  const frac = pipeline && pipeline.total ? pipeline.processed / pipeline.total : 0;
  const Icon = m.icon;

  return (
    <motion.div
      layout
      role="status"
      aria-live="polite"
      className={cn("relative flex items-center gap-2 overflow-hidden rounded-full border border-line bg-s1 py-1 pl-1.5 pr-3 text-sm")}
      transition={{ type: "spring", stiffness: 400, damping: 34 }}
    >
      {busy && <span className="shimmer absolute inset-0 opacity-40" />}
      <span className="relative grid h-5 w-5 place-items-center">
        {stage === "processing" ? (
          <Ring value={frac} color={m.color} />
        ) : (
          <Icon size={16} style={{ color: m.color }} className={cn(busy && stage !== "clustering" && "animate-spin [animation-duration:1.4s]", stage === "clustering" && "animate-pulse")} />
        )}
      </span>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={stage}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
          className="relative whitespace-nowrap font-medium text-t1"
        >
          {m.label}
          {stage === "processing" && pipeline && (
            <span className="tnum ml-1.5 text-t2">
              {pipeline.processed}/{pipeline.total}
            </span>
          )}
        </motion.span>
      </AnimatePresence>
    </motion.div>
  );
}

export function PipelineProgressLine({ pipeline }: { pipeline?: Pipeline }) {
  const stage = pipeline?.stage ?? "idle";
  const busy = ["processing", "clustering", "fixing", "testing"].includes(stage);
  const frac = stage === "processing" && pipeline?.total ? pipeline.processed / pipeline.total : 1;
  return (
    <AnimatePresence>
      {busy && (
        <motion.div
          className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { delay: 0.4 } }}
        >
          <motion.div
            className="h-full"
            style={{ background: "linear-gradient(90deg, var(--accent), var(--accent-2))", boxShadow: "0 0 12px var(--accent)" }}
            animate={{ width: `${frac * 100}%` }}
            transition={{ duration: 0.3 }}
          />
          {stage !== "processing" && <div className="shimmer absolute inset-0" />}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
