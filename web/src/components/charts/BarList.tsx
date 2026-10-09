import { motion } from "framer-motion";
import { useState } from "react";
import { cn } from "@/lib/util";
import { ease } from "@/theme/motion";

export interface BarDatum {
  key: string | number;
  label: string;
  value: number;
  sub?: string;
  color?: string;
  onClick?: () => void;
}

/** Horizontal bar chart with long category names. Single series → one color; value at the tip. */
export function BarList({ data, format = (v) => String(v), max }: { data: BarDatum[]; format?: (v: number) => string; max?: number }) {
  const top = max ?? Math.max(1, ...data.map((d) => d.value));
  const [hover, setHover] = useState<string | number | null>(null);
  return (
    <ul className="space-y-3" role="list">
      {data.map((d, i) => {
        const w = (d.value / top) * 100;
        const on = hover === d.key;
        return (
          <li key={d.key}>
            <button
              type="button"
              onClick={d.onClick}
              onPointerEnter={() => setHover(d.key)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(d.key)}
              onBlur={() => setHover(null)}
              className={cn(
                "group block w-full rounded-lg px-1 py-1 text-left transition-colors",
                d.onClick && "cursor-pointer",
                on && "bg-s2",
              )}
              aria-label={`${d.label}: ${format(d.value)}${d.sub ? `, ${d.sub}` : ""}`}
            >
              <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
                <span className="truncate font-medium text-t1">{d.label}</span>
                {d.sub && <span className="shrink-0 text-tm">{d.sub}</span>}
              </div>
              <div className="flex items-center gap-2">
                <div className="relative h-3.5 flex-1">
                  <motion.div
                    className="absolute inset-y-0 left-0 rounded-r-[4px]"
                    style={{ background: d.color ?? "var(--series-1)", opacity: hover == null || on ? 1 : 0.55 }}
                    initial={{ width: 0 }}
                    animate={{ width: `${w}%` }}
                    transition={{ duration: 0.7, ease, delay: i * 0.05 }}
                  />
                </div>
                <span className="tnum w-10 shrink-0 text-right text-xs font-semibold text-t1">{format(d.value)}</span>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
