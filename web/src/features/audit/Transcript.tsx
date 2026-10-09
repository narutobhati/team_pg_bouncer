import { motion } from "framer-motion";
import { AudioWaveform, Bot, CheckCircle2, Info, User, XCircle } from "lucide-react";
import type { Turn } from "@/types/api";
import { Tooltip } from "@/components/Tooltip";
import { cn } from "@/lib/util";

interface Props {
  turns: Turn[];
  evidenceTurn?: number;
  whyFatal?: string;
  highlight?: number | null;
  mode?: "original" | "fix";
}

/** Chat-style transcript: BOT left, USER right. In "fix" mode, replaced bot turns show old vs new side by side. */
export function Transcript({ turns, evidenceTurn, whyFatal, highlight, mode = "original" }: Props) {
  return (
    <motion.ol
      key={mode}
      className="space-y-3"
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.035 } } }}
    >
      {turns.map((t, i) => {
        const bot = t.speaker === "BOT";
        const isEvidence = mode === "original" && i === evidenceTurn && !!whyFatal;
        const changed = mode === "fix" && t.replay_status && t.replay_status !== "unchanged";
        const repaired = t.replay_status === "repaired";
        return (
          <motion.li
            key={`${mode}-${i}`}
            variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
            className={cn("flex gap-2.5", bot ? "justify-start" : "flex-row-reverse")}
          >
            <span
              className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line", bot ? "bg-accent-soft text-accent" : "bg-s2 text-t2")}
              aria-hidden
            >
              {bot ? <Bot size={14} /> : <User size={14} />}
            </span>
            <div className={cn("flex min-w-0 max-w-[82%] flex-col gap-1", bot ? "items-start" : "items-end")}>
              <div className="flex items-center gap-2 text-[11px] text-tm">
                <span className="font-medium">{bot ? "Bot" : "Caller"}</span>
                <span className="font-mono">{t.timestamp}</span>
                <span className={cn("tnum", t.confidence < 0.75 && "font-semibold text-[color:var(--warning-text)]")}>conf {t.confidence.toFixed(2)}</span>
              </div>

              {changed && t.original_text && t.original_text !== t.text ? (
                <div className="grid w-full gap-1.5 sm:grid-cols-2">
                  <div className="rounded-2xl rounded-tl-md border border-line bg-s2 px-3.5 py-2.5 text-sm text-tm line-through decoration-[color:var(--critical)]">
                    {t.original_text}
                  </div>
                  <motion.div
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.15 + i * 0.03 }}
                    className="rounded-2xl rounded-tl-md border px-3.5 py-2.5 text-sm text-t1"
                    style={{ borderColor: "color-mix(in srgb, var(--good) 45%, transparent)", background: "var(--diff-add-bg)" }}
                  >
                    {t.text}
                  </motion.div>
                </div>
              ) : (
                <div
                  className={cn(
                    "relative rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                    bot ? "rounded-tl-md bg-s1 text-t1 border border-line" : "rounded-tr-md text-t1",
                    highlight === i && "ring-2 ring-accent",
                  )}
                  style={{
                    ...(bot ? {} : { background: "color-mix(in srgb, var(--accent) 12%, var(--surface-1))" }),
                    ...(isEvidence ? { background: "var(--evidence-bg)", boxShadow: "inset 0 0 0 1.5px var(--evidence-ring)" } : {}),
                    ...(changed && !repaired ? { background: "var(--diff-del-bg)", boxShadow: "inset 0 0 0 1.5px color-mix(in srgb, var(--critical) 50%, transparent)" } : {}),
                    ...(changed && repaired ? { background: "var(--diff-add-bg)", boxShadow: "inset 0 0 0 1.5px color-mix(in srgb, var(--good) 45%, transparent)" } : {}),
                  }}
                >
                  {t.text}
                </div>
              )}

              {isEvidence && (
                <Tooltip content={whyFatal} wide side="bottom">
                  <span className="chip cursor-help text-t1" style={{ background: "var(--evidence-bg)" }} tabIndex={0}>
                    <Info size={12} style={{ color: "var(--warning-text)" }} /> Why Fatal
                  </span>
                </Tooltip>
              )}
              {changed && (
                <span className="chip text-t1" style={{ background: repaired ? "var(--diff-add-bg)" : "var(--diff-del-bg)" }}>
                  {repaired ? <CheckCircle2 size={12} style={{ color: "var(--good)" }} /> : <XCircle size={12} style={{ color: "var(--critical)" }} />}
                  {repaired ? "Repaired by fix" : "Still failing"}
                </span>
              )}
              {t.asr_mismatch && t.verbatim && (
                <span className="chip bg-s2 text-t2">
                  <AudioWaveform size={12} style={{ color: "var(--warning-text)" }} />
                  verbatim: <span className="font-mono text-[11px] text-t1">“{t.verbatim}”</span>
                </span>
              )}
            </div>
          </motion.li>
        );
      })}
    </motion.ol>
  );
}
