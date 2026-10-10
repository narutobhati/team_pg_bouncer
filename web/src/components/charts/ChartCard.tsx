import { AnimatePresence, motion } from "framer-motion";
import { BarChart3, Table2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/util";

export interface TableView {
  columns: string[];
  rows: (string | number)[][];
}

interface Props {
  title: string;
  subtitle?: ReactNode;
  table: TableView;
  children: ReactNode;
  className?: string;
  legend?: ReactNode;
}

/** Card wrapper giving every chart a title and a table-view twin. */
export function ChartCard({ title, subtitle, table, children, className, legend }: Props) {
  const [view, setView] = useState<"chart" | "table">("chart");
  return (
    <section className={cn("card flex flex-col p-5", className)} aria-label={title}>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-t1">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-t2">{subtitle}</p>}
        </div>
        <button
          className="btn-ghost -mr-1.5 -mt-1 px-2 py-1 text-xs"
          onClick={() => setView(view === "chart" ? "table" : "chart")}
          aria-label={view === "chart" ? "Show as table" : "Show as chart"}
        >
          {view === "chart" ? <Table2 size={14} /> : <BarChart3 size={14} />}
          {view === "chart" ? "Table" : "Chart"}
        </button>
      </header>
      <AnimatePresence mode="wait" initial={false}>
        {view === "chart" ? (
          <motion.div key="c" className="flex flex-1 flex-col" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            <div className="min-h-0 flex-1">{children}</div>
            {legend && <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-t2">{legend}</div>}
          </motion.div>
        ) : (
          <motion.div key="t" className="flex-1 overflow-x-auto" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line text-tm">
                  {table.columns.map((c) => (
                    <th key={c} className="py-2 pr-3 font-medium">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    {r.map((v, j) => (
                      <td key={j} className={cn("py-2 pr-3 text-t1", typeof v === "number" && "tnum")}>
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

export function LegendItem({ color, label, shape = "rect" }: { color: string; label: string; shape?: "rect" | "line" }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={shape === "line" ? "h-0.5 w-3 rounded-full" : "h-2.5 w-2.5 rounded-[3px]"} style={{ background: color }} />
      {label}
    </span>
  );
}

/** Absolutely positioned chart tooltip. Values lead, labels follow. */
export function ChartTip({ x, y, children, visible }: { x: number; y: number; children: ReactNode; visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1, left: x, top: y }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12, left: { duration: 0.08 }, top: { duration: 0.08 } }}
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-[calc(100%+10px)] whitespace-nowrap rounded-lg border border-line bg-s1 px-2.5 py-1.5 text-xs shadow-card"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
