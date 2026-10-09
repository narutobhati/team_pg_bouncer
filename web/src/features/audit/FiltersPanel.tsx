import { SlidersHorizontal, X } from "lucide-react";
import { useMemo } from "react";
import { CATEGORIES, type Call } from "@/types/api";
import { Checkbox, Segmented, Switch } from "@/components/Misc";
import { humanize } from "@/lib/util";
import type { useAuditFilters } from "./filters";

type F = ReturnType<typeof useAuditFilters>;

function RangeSlider({ min, max, onChange }: { min: number; max: number; onChange: (min: number, max: number) => void }) {
  return (
    <div>
      <div className="relative h-6">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-s3" />
        <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-accent" style={{ left: `${min * 100}%`, right: `${(1 - max) * 100}%` }} />
        {(["min", "max"] as const).map((k) => (
          <input
            key={k}
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={k === "min" ? min : max}
            aria-label={`ASR confidence ${k}`}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (k === "min") onChange(Math.min(v, max - 0.01), max);
              else onChange(min, Math.max(v, min + 0.01));
            }}
            className="range-thumb pointer-events-none absolute inset-0 w-full appearance-none bg-transparent"
          />
        ))}
      </div>
      <div className="tnum mt-1 flex justify-between text-xs text-t2">
        <span>{min.toFixed(2)}</span>
        <span>{max.toFixed(2)}</span>
      </div>
    </div>
  );
}

export function FiltersPanel({ calls, f }: { calls: Call[]; f: F }) {
  const { filters, set, clear, active } = f;
  const langs = useMemo(() => [...new Set(calls.map((c) => c.language))].sort(), [calls]);
  const prompts = useMemo(() => [...new Set(calls.map((c) => c.prompt_version))].sort(), [calls]);
  const batches = useMemo(() => [...new Set(calls.map((c) => c.batch_id))].sort((a, b) => a - b), [calls]);

  return (
    <aside className="card h-fit space-y-5 p-4 lg:sticky lg:top-24">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <SlidersHorizontal size={15} /> Filters
          {active > 0 && <span className="chip bg-accent-soft text-accent">{active}</span>}
        </span>
        {active > 0 && (
          <button className="flex items-center gap-1 text-xs text-t2 hover:text-t1" onClick={clear}>
            <X size={12} /> Clear
          </button>
        )}
      </div>

      <div>
        <div className="label mb-2">Grade</div>
        <Segmented
          size="sm"
          layoutId="grade-filter"
          value={filters.grade}
          onChange={(grade) => set({ grade })}
          options={[
            { value: "all", label: "All" },
            { value: "Fatal", label: "Fatal" },
            { value: "Non-Fatal", label: "Non-Fatal" },
          ]}
        />
      </div>

      <Switch checked={filters.risky} onChange={(risky) => set({ risky })} label={<span>Risky only</span>} />

      <div>
        <div className="label mb-2">Category</div>
        <div className="space-y-2">
          {CATEGORIES.map((c) => (
            <Checkbox
              key={c}
              checked={filters.categories.includes(c)}
              onChange={(on) => set({ categories: on ? [...filters.categories, c] : filters.categories.filter((x) => x !== c) })}
              label={<span className="font-mono text-xs">{humanize(c)}</span>}
            />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
        <label className="block">
          <span className="label mb-1.5 block">Language</span>
          <select className="input py-1.5" value={filters.lang} onChange={(e) => set({ lang: e.target.value })}>
            <option value="">All</option>
            {langs.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label mb-1.5 block">Prompt version</span>
          <select className="input py-1.5" value={filters.prompt} onChange={(e) => set({ prompt: e.target.value })}>
            <option value="">All</option>
            {prompts.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        {batches.length > 1 && (
          <label className="block">
            <span className="label mb-1.5 block">Batch</span>
            <select className="input py-1.5" value={filters.batch} onChange={(e) => set({ batch: e.target.value })}>
              <option value="">All</option>
              {batches.map((b) => (
                <option key={b} value={b}>
                  Batch #{b}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div>
        <div className="label mb-2">ASR confidence</div>
        <RangeSlider min={filters.confMin} max={filters.confMax} onChange={(confMin, confMax) => set({ confMin, confMax })} />
      </div>
    </aside>
  );
}
