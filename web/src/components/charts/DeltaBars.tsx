import { motion } from "framer-motion";
import { ease } from "@/theme/motion";

/** Before → after fatal rate on one shared 0–100% scale (one axis), with the reduction shaded between. */
export function DeltaBars({ before, after, beforeLabel, afterLabel }: { before: number; after: number; beforeLabel: string; afterLabel: string }) {
  const rows = [
    { label: beforeLabel, value: before, color: "var(--critical)" },
    { label: afterLabel, value: after, color: after < before ? "var(--good)" : "var(--critical)" },
  ];
  return (
    <div className="space-y-2.5" role="img" aria-label={`${beforeLabel} ${Math.round(before * 100)}%, ${afterLabel} ${Math.round(after * 100)}%`}>
      {rows.map((r, i) => (
        <div key={r.label} className="grid grid-cols-[92px_1fr_44px] items-center gap-3 text-xs">
          <span className="truncate text-t2">{r.label}</span>
          <div className="relative h-3 rounded-r-[4px] bg-s2">
            {i === 1 && (
              <motion.div
                className="absolute inset-y-0 rounded-r-[4px]"
                style={{
                  left: `${after * 100}%`,
                  background: "repeating-linear-gradient(135deg, var(--diff-add-gutter) 0 3px, transparent 3px 6px)",
                }}
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(0, before - after) * 100}%` }}
                transition={{ duration: 0.8, ease, delay: 0.7 }}
              />
            )}
            <motion.div
              className="absolute inset-y-0 left-0 rounded-r-[4px]"
              style={{ background: r.color }}
              initial={{ width: i === 1 ? `${before * 100}%` : 0 }}
              animate={{ width: `${r.value * 100}%` }}
              transition={{ duration: i === 1 ? 1 : 0.7, ease, delay: i === 1 ? 0.6 : 0.1 }}
            />
          </div>
          <span className="tnum text-right font-semibold text-t1">{Math.round(r.value * 100)}%</span>
        </div>
      ))}
    </div>
  );
}
