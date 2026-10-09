import { AnimatePresence, motion } from "framer-motion";
import { Check, ShieldAlert, Undo2 } from "lucide-react";
import { useState } from "react";
import type { Call } from "@/types/api";
import { useMarkReviewed } from "@/api/hooks";
import { FLAG_META, GradeBadge } from "@/components/Badges";
import { Segmented } from "@/components/Misc";
import { cn } from "@/lib/util";

export function RiskyQueue({ calls, onOpen }: { calls: Call[]; onOpen: (id: number) => void }) {
  const risky = calls.filter((c) => c.risky_flags.length > 0);
  const reviewed = risky.filter((c) => c.reviewed).length;
  const [view, setView] = useState<"pending" | "reviewed" | "all">("pending");
  const mark = useMarkReviewed();
  const shown = risky
    .filter((c) => (view === "all" ? true : view === "pending" ? !c.reviewed : c.reviewed))
    .sort((a, b) => b.risky_flags.length - a.risky_flags.length || b.id - a.id);

  return (
    <section className="card p-4 sm:p-5" aria-label="Risky calls queue">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: "color-mix(in srgb, var(--warning) 16%, transparent)" }}>
            <ShieldAlert size={17} style={{ color: "var(--warning-text)" }} />
          </span>
          <div>
            <h3 className="text-sm font-semibold">Risky calls queue</h3>
            <p className="tnum text-xs text-t2">
              {reviewed} reviewed · {risky.length - reviewed} pending
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden h-1.5 w-32 overflow-hidden rounded-full bg-s3 sm:block" aria-hidden>
            <motion.div className="h-full rounded-full bg-good" animate={{ width: `${risky.length ? (reviewed / risky.length) * 100 : 0}%` }} />
          </div>
          <Segmented
            size="sm"
            layoutId="risky-view"
            value={view}
            onChange={setView}
            options={[
              { value: "pending", label: "Pending" },
              { value: "reviewed", label: "Reviewed" },
              { value: "all", label: "All" },
            ]}
          />
        </div>
      </div>
      {shown.length === 0 ? (
        <div className="py-8 text-center text-sm text-tm">{risky.length ? "Nothing here — nice." : "No risky calls flagged yet."}</div>
      ) : (
        <ul className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence initial={false} mode="popLayout">
            {shown.slice(0, 30).map((c) => (
              <motion.li
                key={c.id}
                layout
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: c.reviewed && view === "all" ? 0.6 : 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
                className="group rounded-xl border border-line bg-s2 p-3 transition-colors hover:border-[color:var(--border-strong)]"
              >
                <div className="flex items-start justify-between gap-2">
                  <button className="min-w-0 text-left" onClick={() => onOpen(c.id)}>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-t1">{c.call_id}</span>
                      <GradeBadge grade={c.grade} />
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {c.risky_flags.map((f) => {
                        const { icon: Icon, label } = FLAG_META[f];
                        return (
                          <span key={f} className="chip text-t1" style={{ background: "color-mix(in srgb, var(--warning) 16%, transparent)" }}>
                            <Icon size={12} style={{ color: "var(--warning-text)" }} />
                            {label}
                          </span>
                        );
                      })}
                    </div>
                    <p className="mt-1.5 line-clamp-1 text-xs text-t2">{c.reason}</p>
                  </button>
                  <button
                    onClick={() => mark.mutate(c.id)}
                    className={cn("btn shrink-0 px-2.5 py-1 text-xs", c.reviewed ? "btn-ghost" : "btn-outline")}
                    aria-label={c.reviewed ? `Undo review of ${c.call_id}` : `Mark ${c.call_id} reviewed`}
                  >
                    {c.reviewed ? <Undo2 size={13} /> : <Check size={13} />}
                    {c.reviewed ? "Undo" : "Mark reviewed"}
                  </button>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}
