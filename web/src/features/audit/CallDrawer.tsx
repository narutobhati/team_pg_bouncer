import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, Check, Loader2, Play, Quote, Undo2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCalls, useMarkReviewed, useReplayCall, useRootCauses } from "@/api/hooks";
import { CategoryTag, GradeBadge, RiskyFlags, TypeBadge, VersionChip } from "@/components/Badges";
import { Drawer } from "@/components/Overlay";
import { Segmented } from "@/components/Misc";
import { ConfidenceSparkline } from "@/components/charts/Sparkline";
import { dateTime, duration } from "@/lib/util";
import { Transcript } from "./Transcript";
import { useCallParam } from "./useCallParam";

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="label">{label}</div>
      <div className="mt-1 truncate text-sm text-t1">{children}</div>
    </div>
  );
}

export function CallDrawer() {
  const [callId, open] = useCallParam();
  const { data: calls = [] } = useCalls();
  const { data: rcs = [] } = useRootCauses();
  const call = calls.find((c) => c.id === callId);
  const rc = call?.root_cause_id ? rcs.find((r) => r.id === call.root_cause_id) : undefined;
  const [view, setView] = useState<"original" | "fix">("original");
  const [hoverTurn, setHoverTurn] = useState<number | null>(null);
  const replay = useReplayCall();
  const mark = useMarkReviewed();
  const nav = useNavigate();

  const hasSim = !!call?.simulated_transcript;
  const sim = call?.simulated_transcript;
  const changedTurns = sim?.filter((t) => t.replay_status && t.replay_status !== "unchanged").length ?? 0;
  const activeView = hasSim ? view : "original";

  return (
    <Drawer
      open={callId != null && !!call}
      onClose={() => {
        open(null);
        setView("original");
      }}
      title={
        call ? (
          <span className="flex flex-wrap items-center gap-2.5">
            <span className="font-mono">{call.call_id}</span>
            <GradeBadge grade={call.grade} />
            {call.simulated_grade && call.simulated_grade !== call.grade && (
              <motion.span initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-1.5 text-sm font-normal text-t2">
                → <GradeBadge grade={call.simulated_grade} /> with fix
              </motion.span>
            )}
          </span>
        ) : (
          ""
        )
      }
      subtitle={call ? `${call.file_name} · Batch #${call.batch_id}` : undefined}
      footer={
        call && (
          <div className="flex flex-wrap items-center gap-2">
            {call.risky_flags.length > 0 && (
              <button className="btn-outline" onClick={() => mark.mutate(call.id)}>
                {call.reviewed ? <Undo2 size={15} /> : <Check size={15} />}
                {call.reviewed ? "Mark unreviewed" : "Mark reviewed"}
              </button>
            )}
            <button
              className="btn-primary ml-auto"
              disabled={replay.isPending}
              onClick={() =>
                replay.mutate(call.id, {
                  onSuccess: () => setView("fix"),
                })
              }
            >
              {replay.isPending ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
              {replay.isPending ? "Replaying…" : "Replay with current prompt"}
            </button>
          </div>
        )
      }
    >
      {call && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 rounded-2xl border border-line bg-s1 p-4 sm:grid-cols-4">
            <Meta label="Date">{dateTime(call.created_at)}</Meta>
            <Meta label="Duration">
              <span className="tnum">{duration(call.duration_sec)}</span>
            </Meta>
            <Meta label="Language">
              <span className="font-mono">{call.language}</span>
            </Meta>
            <Meta label="ASR confidence">
              <span className="tnum">{call.overall_confidence.toFixed(2)}</span>
            </Meta>
            <Meta label="Prompt">
              <VersionChip v={call.prompt_version} />
            </Meta>
            <Meta label="Category">
              <CategoryTag category={call.category} />
            </Meta>
            <div className="col-span-2">
              <div className="label">Risky flags</div>
              <div className="mt-1">
                <RiskyFlags flags={call.risky_flags} showLabel />
              </div>
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative overflow-hidden rounded-2xl border p-4"
            style={{
              borderColor: `color-mix(in srgb, var(${call.grade === "Fatal" ? "--critical" : "--good"}) 30%, transparent)`,
              background: `color-mix(in srgb, var(${call.grade === "Fatal" ? "--critical" : "--good"}) 6%, var(--surface-1))`,
            }}
          >
            <div className="label mb-1.5">Verdict</div>
            <p className="text-[15px] font-medium text-t1">{call.reason}</p>
            {call.grade === "Fatal" && (
              <p className="mt-2 flex gap-2 text-sm text-t2">
                <Quote size={14} className="mt-0.5 shrink-0 text-tm" />
                <span>
                  {call.evidence} <span className="font-mono text-xs text-tm">@ {call.evidence_timestamp}</span>
                </span>
              </p>
            )}
            {rc && (
              <button
                onClick={() => {
                  open(null);
                  nav(`/issues?rc=${rc.id}`);
                }}
                className="mt-3 inline-flex items-center gap-2 rounded-xl border border-line bg-s1 px-3 py-1.5 text-sm transition-colors hover:border-accent"
              >
                <span className="text-tm">Root cause</span>
                <span className="font-medium text-t1">{rc.name}</span>
                <TypeBadge type={rc.type} />
                <ArrowUpRight size={14} className="text-tm" />
              </button>
            )}
          </motion.div>

          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Transcript</h3>
              <AnimatePresence>
                {hasSim && (
                  <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
                    <Segmented
                      size="sm"
                      layoutId="transcript-view"
                      value={view}
                      onChange={setView}
                      options={[
                        { value: "original", label: "Original" },
                        { value: "fix", label: `With fix${changedTurns ? ` · ${changedTurns}` : ""}` },
                      ]}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <AnimatePresence>
              {replay.isPending && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mb-3 overflow-hidden">
                  <div className="relative overflow-hidden rounded-xl border border-line bg-s1 px-4 py-3 text-sm text-t2">
                    <span className="shimmer absolute inset-0 opacity-30" />
                    <span className="relative flex items-center gap-2">
                      <Loader2 size={14} className="animate-spin text-accent" /> Replaying caller turns against the active prompt…
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            {activeView === "fix" && sim && changedTurns === 0 && (
              <p className="mb-3 rounded-xl bg-s2 px-3 py-2 text-xs text-t2">No bot responses changed under the current prompt for this call.</p>
            )}
            <Transcript
              turns={activeView === "fix" && sim ? sim : call.transcript}
              mode={activeView}
              evidenceTurn={call.evidence_turn}
              whyFatal={call.grade === "Fatal" ? call.reason : undefined}
              highlight={hoverTurn}
            />
          </section>

          <section className="rounded-2xl border border-line bg-s1 p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">ASR confidence timeline</h3>
              <span className="text-xs text-tm">hover to find the turn</span>
            </div>
            <ConfidenceSparkline turns={call.transcript} evidenceTurn={call.grade === "Fatal" ? call.evidence_turn : undefined} onHover={setHoverTurn} />
          </section>
        </div>
      )}
    </Drawer>
  );
}
