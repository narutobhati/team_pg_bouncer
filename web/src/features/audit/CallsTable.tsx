import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, ArrowUp, CheckCircle2, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { Call } from "@/types/api";
import { CategoryTag, GradeBadge, RiskyFlags, VersionChip } from "@/components/Badges";
import { useUi } from "@/store/ui";
import { cn, duration } from "@/lib/util";
import type { SortKey } from "./filters";

const PAGE = 25;

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
  const [page, setPage] = useState(0);
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

  // Reset to first page when sort or filtered calls change
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE));
  const safePage = Math.min(page, totalPages - 1);
  const rows = sorted.slice(safePage * PAGE, safePage * PAGE + PAGE);

  const changeSort = (key: SortKey) => {
    setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : -1 }));
    setPage(0);
  };

  return (
    <div className="card flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="text-sm">
          <span className="font-semibold text-t1">Calls</span>
          <span className="tnum ml-2 text-tm">
            {calls.length === total ? total : `${calls.length} of ${total}`}
          </span>
        </div>
        <label className="relative w-full sm:w-64">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-tm" />
          <input
            className="input py-1.5 pl-8"
            placeholder="Search call, reason, file…"
            value={query}
            onChange={(e) => { onQuery(e.target.value); setPage(0); }}
            aria-label="Search calls"
          />
        </label>
      </div>

      {/* Scrollable table */}
      <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: "calc(100vh - 18rem)" }}>
        <table className="w-full min-w-[1080px] text-left text-sm">
          <thead className="sticky top-0 z-10 bg-s1">
            <tr className="border-b border-line text-xs text-tm">
              {COLS.map((c, i) => (
                <th
                  key={i}
                  className={cn("px-3 py-2.5 font-medium first:pl-4", c.className)}
                  aria-sort={c.key && sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
                >
                  {c.key ? (
                    <button
                      className="inline-flex items-center gap-1 hover:text-t1"
                      onClick={() => changeSort(c.key!)}
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
                    <td className="px-3 py-2.5 font-mono text-xs font-medium text-t1">
                      <span className="flex items-center gap-1.5">
                        {c.call_id}
                        {c.verified && <span title="Transcript verified"><CheckCircle2 size={12} className="shrink-0 text-emerald-500" /></span>}
                      </span>
                    </td>
                    <td className="tnum px-3 py-2.5 text-t2">{duration(c.duration_sec)}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-t2">{c.language}</td>
                    <td className="px-3 py-2.5"><GradeBadge grade={c.grade} /></td>
                    <td className="px-3 py-2.5"><CategoryTag category={c.category} /></td>
                    <td className="max-w-[360px] truncate px-3 py-2.5 text-t2" title={c.reason}>{c.reason}</td>
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <RiskyFlags flags={c.risky_flags} />
                    </td>
                    <td className="px-3 py-2.5"><VersionChip v={c.prompt_version} /></td>
                    <td className="px-3 py-2.5 text-tm">
                      <ChevronRight size={16} className="transition-transform group-hover:translate-x-0.5 group-hover:text-t1" aria-label="Open call" />
                    </td>
                  </motion.tr>
                );
              })}
            </AnimatePresence>
          </tbody>
        </table>
        {calls.length === 0 && (
          <div className="px-4 py-14 text-center text-sm text-tm">No calls match these filters.</div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-line px-4 py-2.5">
          <span className="tnum text-xs text-tm">
            {safePage * PAGE + 1}–{Math.min(safePage * PAGE + PAGE, sorted.length)} of {sorted.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              className="btn-ghost px-2 py-1"
              disabled={safePage === 0}
              onClick={() => setPage((p) => p - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft size={15} />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i).map((i) => (
              <button
                key={i}
                className={cn(
                  "tnum min-w-[28px] rounded-md px-1.5 py-0.5 text-xs transition-colors",
                  i === safePage ? "bg-accent text-white" : "btn-ghost"
                )}
                onClick={() => setPage(i)}
                aria-current={i === safePage ? "page" : undefined}
              >
                {i + 1}
              </button>
            ))}
            <button
              className="btn-ghost px-2 py-1"
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              aria-label="Next page"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
