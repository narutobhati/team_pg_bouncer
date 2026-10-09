import { motion } from "framer-motion";
import { useState } from "react";
import type { Turn } from "@/types/api";
import { useMeasure } from "@/lib/util";
import { ease } from "@/theme/motion";
import { ChartTip } from "./ChartCard";

const PAD = { l: 30, r: 10, t: 10, b: 18 };

/** ASR confidence per turn with the low-confidence threshold as a solid hairline; dips below it get warning markers. */
export function ConfidenceSparkline({
  turns,
  threshold = 0.75,
  height = 110,
  onHover,
  evidenceTurn,
}: {
  turns: Turn[];
  threshold?: number;
  height?: number;
  onHover?: (i: number | null) => void;
  evidenceTurn?: number;
}) {
  const [ref, { width }] = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const w = Math.max(0, width - PAD.l - PAD.r);
  const h = height - PAD.t - PAD.b;
  const minY = 0.5;
  const xs = (i: number) => PAD.l + (turns.length <= 1 ? 0 : (i / (turns.length - 1)) * w);
  const ys = (v: number) => PAD.t + h - ((Math.max(minY, v) - minY) / (1 - minY)) * h;
  const line = turns.map((t, i) => `${i ? "L" : "M"}${xs(i)},${ys(t.confidence)}`).join(" ");
  const area = turns.length ? `${line} L${xs(turns.length - 1)},${PAD.t + h} L${xs(0)},${PAD.t + h} Z` : "";

  const set = (i: number | null) => {
    setHover(i);
    onHover?.(i);
  };

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          className="outline-none"
          tabIndex={0}
          role="img"
          aria-label={`ASR confidence per turn, ${turns.filter((t) => t.confidence < threshold).length} turns below ${threshold}`}
          onPointerMove={(e) => {
            const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
            const i = Math.round(((x - PAD.l) / Math.max(1, w)) * (turns.length - 1));
            set(Math.max(0, Math.min(turns.length - 1, i)));
          }}
          onPointerLeave={() => set(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") set(Math.min(turns.length - 1, (hover ?? -1) + 1));
            if (e.key === "ArrowLeft") set(Math.max(0, (hover ?? 1) - 1));
          }}
          onBlur={() => set(null)}
        >
          {[0.5, 1].map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={PAD.l + w} y1={ys(t)} y2={ys(t)} stroke="var(--grid)" />
              <text x={PAD.l - 6} y={ys(t)} dy="0.32em" textAnchor="end" className="tnum fill-[color:var(--text-muted)] text-[9px]">
                {t.toFixed(1)}
              </text>
            </g>
          ))}
          <line x1={PAD.l} x2={PAD.l + w} y1={ys(threshold)} y2={ys(threshold)} stroke="var(--warning)" strokeOpacity={0.7} />
          <text x={PAD.l + w} y={ys(threshold) - 4} textAnchor="end" className="fill-[color:var(--text-muted)] text-[9px]">
            threshold {threshold}
          </text>
          {evidenceTurn != null && turns[evidenceTurn] && (
            <rect x={xs(evidenceTurn) - 6} y={PAD.t} width={12} height={h} rx={3} fill="var(--evidence-bg)" />
          )}
          <motion.path d={area} fill="var(--series-1)" fillOpacity={0.1} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} />
          <motion.path
            d={line}
            fill="none"
            stroke="var(--series-1)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.8, ease }}
          />
          {hover != null && <line x1={xs(hover)} x2={xs(hover)} y1={PAD.t} y2={PAD.t + h} stroke="var(--axis)" />}
          {turns.map((t, i) =>
            t.confidence < threshold || hover === i ? (
              <circle
                key={i}
                cx={xs(i)}
                cy={ys(t.confidence)}
                r={hover === i ? 5 : 4}
                fill={t.confidence < threshold ? "var(--warning)" : "var(--series-1)"}
                stroke="var(--chart-surface)"
                strokeWidth={2}
              />
            ) : null,
          )}
          <text x={PAD.l} y={height - 4} className="fill-[color:var(--text-muted)] font-mono text-[9px]">
            {turns[0]?.timestamp}
          </text>
          <text x={PAD.l + w} y={height - 4} textAnchor="end" className="fill-[color:var(--text-muted)] font-mono text-[9px]">
            {turns[turns.length - 1]?.timestamp}
          </text>
        </svg>
      )}
      {hover != null && turns[hover] && (
        <ChartTip visible x={xs(hover)} y={ys(turns[hover].confidence)}>
          <div className="text-sm font-semibold text-t1">{turns[hover].confidence.toFixed(2)}</div>
          <div className="text-tm">
            {turns[hover].timestamp} · {turns[hover].speaker}
            {turns[hover].asr_mismatch ? " · verbatim ≠ normalized" : ""}
          </div>
        </ChartTip>
      )}
    </div>
  );
}
