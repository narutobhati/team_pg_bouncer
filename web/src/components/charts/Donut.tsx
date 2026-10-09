import { motion } from "framer-motion";
import { useState } from "react";
import { ease } from "@/theme/motion";

export interface Slice {
  key: string;
  label: string;
  value: number;
  color: string;
  onClick?: () => void;
}

/** Part-to-whole donut (≤ 6 segments) with a 2px surface gap between segments and a centre label. */
export function Donut({ data, size = 168, thickness = 18, center }: { data: Slice[]; size?: number; thickness?: number; center?: { value: string; label: string } }) {
  const [hover, setHover] = useState<string | null>(null);
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = (size - thickness) / 2;
  const C = 2 * Math.PI * r;
  const gap = data.filter((d) => d.value > 0).length > 1 ? 2 : 0; // 2px surface gap between segments
  let offset = 0;
  const active = data.find((d) => d.key === hover);

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={thickness} />
        {data.map((d, i) => {
          const len = (d.value / total) * C;
          const dash = Math.max(0, len - gap);
          const el = (
            <motion.circle
              key={d.key}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={d.color}
              strokeWidth={hover === d.key ? thickness + 4 : thickness}
              strokeDasharray={`${dash} ${C}`}
              initial={{ strokeDashoffset: -offset, opacity: 0, strokeDasharray: `0 ${C}` }}
              animate={{ strokeDashoffset: -offset, opacity: hover && hover !== d.key ? 0.45 : 1, strokeDasharray: `${dash} ${C}` }}
              transition={{ duration: 0.9, ease, delay: 0.1 + i * 0.12 }}
              style={{ cursor: d.onClick ? "pointer" : "default", outline: "none" }}
              onPointerEnter={() => setHover(d.key)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(d.key)}
              onBlur={() => setHover(null)}
              onClick={d.onClick}
              tabIndex={0}
              role="img"
              aria-label={`${d.label}: ${d.value} (${Math.round((d.value / total) * 100)}%)`}
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="text-2xl font-semibold text-t1">
            {active ? `${Math.round((active.value / total) * 100)}%` : center?.value}
          </div>
          <div className="text-[11px] text-t2">{active ? `${active.label} · ${active.value}` : center?.label}</div>
        </div>
      </div>
    </div>
  );
}
