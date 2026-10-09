import { motion } from "framer-motion";
import { cn } from "@/lib/util";

export interface DiffLine {
  kind: "context" | "add" | "remove";
  text: string;
}

/** GitHub-style line diff. Context lines can be collapsed to keep focus on the change. */
export function Diff({ lines, className, animate = true }: { lines: DiffLine[]; className?: string; animate?: boolean }) {
  return (
    <div className={cn("overflow-hidden rounded-xl border border-line font-mono text-[12.5px] leading-relaxed", className)}>
      {lines.map((l, i) => (
        <motion.div
          key={i}
          initial={animate && l.kind !== "context" ? { opacity: 0, x: l.kind === "add" ? -6 : 6 } : false}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.05 * i, duration: 0.3 }}
          className="grid grid-cols-[28px_1fr]"
          style={{ background: l.kind === "add" ? "var(--diff-add-bg)" : l.kind === "remove" ? "var(--diff-del-bg)" : "var(--surface-1)" }}
        >
          <span
            className="select-none py-1 text-center font-semibold"
            style={{
              background: l.kind === "add" ? "var(--diff-add-gutter)" : l.kind === "remove" ? "var(--diff-del-gutter)" : "var(--surface-2)",
              color: l.kind === "add" ? "var(--good-text)" : l.kind === "remove" ? "var(--critical-text)" : "var(--text-muted)",
            }}
            aria-hidden
          >
            {l.kind === "add" ? "+" : l.kind === "remove" ? "−" : " "}
          </span>
          <span className={cn("whitespace-pre-wrap break-words px-3 py-1", l.kind === "context" ? "text-t2" : "text-t1")}>
            <span className="sr-only">{l.kind === "add" ? "Added: " : l.kind === "remove" ? "Removed: " : ""}</span>
            {l.text}
          </span>
        </motion.div>
      ))}
    </div>
  );
}
