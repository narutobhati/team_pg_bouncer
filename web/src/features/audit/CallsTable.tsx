import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, ArrowUp, ChevronRight, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { Call } from "@/types/api";
import { CategoryTag, GradeBadge, RiskyFlags, VersionChip } from "@/components/Badges";
import { useUi } from "@/store/ui";
import { cn, duration } from "@/lib/util";
import type { SortKey } from "./filters";

const PAGE = 60;

const COLS: { key: SortKey | null; label: string; className?: string }[] = [
  { key: "id", label: "#", className: "w-12" },
  { key: null, label: "Call ID" },
  { key: "duration_sec", label: "Duration" },
  { key: "language", label: "Language" },
  { key: "grade", label: "Grade" },
  { key: null, label: "Category" },
  { key: null, label: "Reason", className: "min-w-[260px]" },
  { key: null, label: "Risky" },
  { key: "prompt_version", label: "Prompt" },
  { key: null, label: "", className: "w-10" },
];

export function CallsTable({
  calls,
  onOpen,
  query,
  onQuery,
  total,
}: {
  calls: Call[];
  onOpen: (id: number) => void;
  query: string;
  onQuery: (q: string) => void;
  total: number;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "id", dir: -1 });
  const [limit, setLimit] = useState(PAGE);
  const fresh = useUi((s) => s.fresh);

  const sorted = useMemo(() => {
    const out = calls.slice();
    out.sort((a, b) => {
      const av = a[sort.key] as string | number;
      const bv = b[sort.key] as string | number;
      return (av > bv ? 1 : av < bv ? -1 : 0) * sort.dir;
    });
    return out;
  }, [calls, sort]);

  const rows = sorted.slice(0, limit);

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="text-sm">
          <span className="font-semibold text-t1">Calls</span>
          <span className="tnum ml-2 text-tm">
            {calls.length === total ? total : `${calls.length} of ${total}`}
          </span>
        </div>
        <label className="relative w-full sm:w-64">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-tm" />
          <input className="input py-1.5 pl-8" placeholder="Search call, reason, file…" value={query} onChange={(e) => onQuery(e.target.value)} aria-label="Search calls" />
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] text-left text-sm">
          <thead className="sticky top-0 z-10 bg-s1">
            <tr className="border-b border-line text-xs text-tm">
              {COLS.map((c, i) => (
                <th key={i} className={cn("px-3 py-2.5 font-medium first:pl-4", c.className)} aria-sort={c.key && sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
                  {c.key ? (
                    <button
                      className="inline-flex items-center gap-1 hover:text-t1"
                      onClick={() => setSort((s) => ({ key: c.key!, dir: s.key === c.key ? ((-s.dir) as 1 | -1) : -1 }))}
                    >
                      {c.label}
                      {sort.key === c.key && (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {rows.map((c) => {
                const isFresh = fresh.has(c.id);
                return (
                  <motion.tr
                    key={c.id}
                    layout="position"
                    initial={isFresh ? { opacity: 0, y: -14 } : false}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                    onClick={() => onOpen(c.id)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(c.id))}
                    tabIndex={0}
                    className="group relative cursor-pointer border-b border-line outline-none transition-colors last:border-0 hover:bg-s2 focus-visible:bg-s2"
                  >
                    <td className="tnum relative px-3 py-2.5 pl-4 text-tm">
                      {isFresh && (
                        <motion.span
                          className="absolute inset-y-0 left-0 w-full"
                          style={{ background: "linear-gradient(90deg, var(--accent-soft), transparent 60%)" }}
                          initial={{ opacity: 1 }}
                          animate={{ opacity: 0 }}
                          transition={{ duration: 1.4, delay: 0.2 }}
                        />
                      )}
                      <span className="relative">{c.id}</span>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs font-medium text-t1">{c.call_id}</td>
                    <td className="tnum px-3 py-2.5 text-t2">{duration(c.duration_sec)}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-t2">{c.language}</td>
                    <td className="px-3 py-2.5">
                      <GradeBadge grade={c.grade} />
                    </td>
                    <td className="px-3 py-2.5">
                      <CategoryTag category={c.category} />
                    </td>
                    <td className="max-w-[360px] truncate px-3 py-2.5 text-t2" title={c.reason}>
                      {c.reason}
                    </td>
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <RiskyFlags flags={c.risky_flags} />
                    </td>
                    <td className="px-3 py-2.5">
                      <VersionChip v={c.prompt_version} />
                    </td>
                    <td className="px-3 py-2.5 text-tm">
                      <ChevronRight size={16} className="transition-transform group-hover:translate-x-0.5 group-hover:text-t1" aria-label="Open call" />
                    </td>
                  </motion.tr>
                );
              })}
            </AnimatePresence>
          </tbody>
        </table>
        {calls.length === 0 && <div className="px-4 py-14 text-center text-sm text-tm">No calls match these filters.</div>}
      </div>
      {sorted.length > limit && (
        <div className="border-t border-line p-3 text-center">
          <button className="btn-ghost text-xs" onClick={() => setLimit((l) => l + PAGE)}>
            Show {Math.min(PAGE, sorted.length - limit)} more · {sorted.length - limit} hidden
          </button>
        </div>
      )}
    </div>
  );
}
