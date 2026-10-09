import { motion } from "framer-motion";
import { AudioLines, FlaskConical, GitBranch, Layers, Scale, Wrench, X } from "lucide-react";
import { useMemo } from "react";
import { useCalls, usePipeline, useRootCauses } from "@/api/hooks";
import { UploadCta } from "@/components/Misc";
import { fadeUp, stagger } from "@/theme/motion";
import { applyFilters, useAuditFilters } from "./filters";
import { FiltersPanel } from "./FiltersPanel";
import { CallsTable } from "./CallsTable";
import { RiskyQueue } from "./RiskyQueue";
import { useCallParam } from "./useCallParam";

const LOOP = [
  { icon: AudioLines, title: "Transcribe", body: "Saaras v4 codemix + diarization, verbatim vs normalized" },
  { icon: Scale, title: "Grade", body: "Fatal / Non-Fatal with evidence, plus risky flags" },
  { icon: Layers, title: "Cluster", body: "Embeddings group failures into ranked root causes" },
  { icon: Wrench, title: "Fix", body: "Minimal prompt diffs, one click to approve" },
  { icon: FlaskConical, title: "Prove", body: "Replay affected calls on the new prompt" },
  { icon: GitBranch, title: "Version", body: "Every prompt change tracked with its impact" },
];

function Hero() {
  return (
    <motion.section variants={stagger(0.07)} initial="hidden" animate="show" className="card relative overflow-hidden px-6 py-12 sm:px-10 sm:py-16">
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(60% 80% at 50% -10%, var(--accent-soft), transparent 70%)" }} />
      <motion.div variants={fadeUp} className="relative mx-auto max-w-2xl text-center">
        <span className="chip mb-4 border border-line bg-s2 text-t2">
          <span className="h-1.5 w-1.5 rounded-full bg-good pulse-dot text-good" /> Pipeline idle — ready for a batch
        </span>
        <h1 className="text-balance text-3xl font-semibold tracking-tight text-t1 sm:text-4xl">
          From call recordings to a{" "}
          <span className="bg-clip-text text-transparent" style={{ backgroundImage: "linear-gradient(90deg, var(--accent), var(--accent-2))" }}>
            proven prompt fix
          </span>
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-[15px] text-t2">
          Drop a zip of voice-bot calls. Every call is transcribed and graded live, failures are clustered into root causes, and each fix is replay-tested before it ships.
        </p>
        <div className="mt-7 flex justify-center">
          <UploadCta />
        </div>
      </motion.div>
      <motion.ol variants={stagger(0.06, 0.25)} className="relative mx-auto mt-12 grid max-w-5xl grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {LOOP.map((s, i) => (
          <motion.li key={s.title} variants={fadeUp} className="relative rounded-xl border border-line bg-s1 p-3.5">
            <div className="mb-2 flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent-soft">
                <s.icon size={14} className="text-accent" />
              </span>
              <span className="tnum text-[11px] text-tm">0{i + 1}</span>
            </div>
            <div className="text-sm font-semibold text-t1">{s.title}</div>
            <div className="mt-0.5 text-xs leading-snug text-t2">{s.body}</div>
          </motion.li>
        ))}
      </motion.ol>
    </motion.section>
  );
}

export function AuditPage() {
  const { data: calls = [], isLoading } = useCalls();
  const { data: pipeline } = usePipeline();
  const { data: rcs = [] } = useRootCauses();
  const f = useAuditFilters();
  const [, openCall] = useCallParam();
  const filtered = useMemo(() => applyFilters(calls, f.filters), [calls, f.filters]);
  const rcFilter = f.filters.rc ? rcs.find((r) => String(r.id) === f.filters.rc) : undefined;

  if (!isLoading && calls.length === 0 && (!pipeline || pipeline.stage === "idle")) return <Hero />;

  return (
    <div className="space-y-6">
      {rcFilter && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 rounded-xl border border-line bg-s1 px-3 py-2 text-sm">
          <Layers size={14} className="text-accent" />
          <span className="text-t2">Root cause:</span>
          <span className="font-medium text-t1">{rcFilter.name}</span>
          <button className="btn-ghost ml-auto px-2 py-1 text-xs" onClick={() => f.set({ rc: "" })}>
            <X size={12} /> Clear
          </button>
        </motion.div>
      )}
      <div className="grid gap-6 lg:grid-cols-[248px_1fr]">
        <FiltersPanel calls={calls} f={f} />
        <div className="min-w-0 space-y-6">
          <CallsTable calls={filtered} total={calls.length} onOpen={openCall} query={f.filters.q} onQuery={(q) => f.set({ q })} />
          <RiskyQueue calls={calls} onOpen={openCall} />
        </div>
      </div>
    </div>
  );
}
