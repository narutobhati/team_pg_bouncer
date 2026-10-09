import { motion } from "framer-motion";
import { useState } from "react";
import { useMeasure } from "@/lib/util";
import { ease } from "@/theme/motion";
import { ChartTip } from "./ChartCard";

export interface TrendPoint {
  x: string;
  y: number; // 0..1
  projected?: boolean;
  note?: string;
}

const PAD = { l: 36, r: 44, t: 16, b: 26 };

/** Single-series line over prompt versions: 2px line, ≥8px ringed markers, crosshair that snaps to the nearest version. */
export function TrendLine({ data, height = 190, color = "var(--series-1)" }: { data: TrendPoint[]; height?: number; color?: string }) {
  const [ref, { width }] = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const w = Math.max(0, width - PAD.l - PAD.r);
  const h = height - PAD.t - PAD.b;
  const maxY = Math.max(0.2, Math.ceil(Math.max(...data.map((d) => d.y), 0) * 10 + 0.5) / 10);
  const ticks = [0, maxY / 2, maxY];
  const xs = (i: number) => PAD.l + (data.length <= 1 ? w / 2 : (i / (data.length - 1)) * w);
  const ys = (v: number) => PAD.t + h - (v / maxY) * h;
  const path = data.map((d, i) => `${i ? "L" : "M"}${xs(i)},${ys(d.y)}`).join(" ");
  const area = data.length ? `${path} L${xs(data.length - 1)},${PAD.t + h} L${xs(0)},${PAD.t + h} Z` : "";
  const last = data.length - 1;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!data.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    let best = 0;
    data.forEach((_, i) => {
      if (Math.abs(xs(i) - x) < Math.abs(xs(best) - x)) best = i;
    });
    setHover(best);
  };

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") setHover((h) => Math.min(last, (h ?? -1) + 1));
            if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? 1) - 1));
          }}
          onBlur={() => setHover(null)}
          role="img"
          aria-label={`Fatal rate by prompt version: ${data.map((d) => `${d.x} ${Math.round(d.y * 100)}%`).join(", ")}`}
          className="outline-none"
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={PAD.l + w} y1={ys(t)} y2={ys(t)} stroke={t === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
              <text x={PAD.l - 8} y={ys(t)} dy="0.32em" textAnchor="end" className="tnum fill-[color:var(--text-muted)] text-[10px]">
                {Math.round(t * 100)}%
              </text>
            </g>
          ))}
          {data.map((d, i) => (
            <text key={d.x} x={xs(i)} y={height - 6} textAnchor="middle" className="fill-[color:var(--text-muted)] font-mono text-[10px]">
              {d.x}
            </text>
          ))}
          {data.length > 1 && (
            <>
              <motion.path d={area} fill={color} fillOpacity={0.1} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 0.4 }} />
              <motion.path
                d={path}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.9, ease }}
              />
            </>
          )}
          {hover != null && <line x1={xs(hover)} x2={xs(hover)} y1={PAD.t} y2={PAD.t + h} stroke="var(--axis)" strokeWidth={1} />}
          {data.map((d, i) => (
            <motion.circle
              key={d.x}
              cx={xs(i)}
              cy={ys(d.y)}
              r={hover === i ? 6 : 4.5}
              fill={d.projected ? "var(--chart-surface)" : color}
              stroke={d.projected ? color : "var(--chart-surface)"}
              strokeWidth={2}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.3 + i * 0.12, type: "spring", stiffness: 400, damping: 20 }}
            />
          ))}
          {last >= 0 && (
            <text x={xs(last) + 10} y={ys(data[last].y)} dy="0.32em" className="fill-[color:var(--text-1)] text-[11px] font-semibold">
              {Math.round(data[last].y * 100)}%
            </text>
          )}
        </svg>
      )}
      {hover != null && data[hover] && (
        <ChartTip visible x={xs(hover)} y={ys(data[hover].y)}>
          <div className="text-sm font-semibold text-t1">{Math.round(data[hover].y * 100)}% fatal</div>
          <div className="text-tm">
            Prompt {data[hover].x}
            {data[hover].projected ? " · projected from replay" : ""}
            {data[hover].note ? ` · ${data[hover].note}` : ""}
          </div>
        </ChartTip>
      )}
    </div>
  );
}
