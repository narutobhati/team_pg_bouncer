import { AnimatePresence, motion } from "framer-motion";
import { Bell, Monitor, Moon, RotateCcw, Sun, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api, isMock } from "@/api";
import { usePipeline } from "@/api/hooks";
import { useUi, type Notice, type Theme } from "@/store/ui";
import { cn, timeAgo } from "@/lib/util";
import { PipelineChip, PipelineProgressLine } from "./PipelineChip";

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative grid h-9 w-9 place-items-center rounded-xl" style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-2))" }}>
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <motion.path
            d="M3 13h3l2-6 3 11 3-8 2 3h5"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.2, ease: "easeInOut" }}
          />
        </svg>
        <span className="absolute inset-0 rounded-xl" style={{ boxShadow: "0 6px 20px -6px var(--accent)" }} />
      </div>
      <div className="hidden leading-tight sm:block">
        <div className="text-[15px] font-semibold tracking-tight text-t1">Call Audit Loop</div>
        <div className="text-[11px] text-tm">grade · cluster · fix · prove</div>
      </div>
    </div>
  );
}

const THEMES: { value: Theme; icon: typeof Sun; label: string }[] = [
  { value: "light", icon: Sun, label: "Light" },
  { value: "dark", icon: Moon, label: "Dark" },
  { value: "system", icon: Monitor, label: "System" },
];

function ThemeToggle() {
  const { theme, setTheme } = useUi();
  const i = THEMES.findIndex((t) => t.value === theme);
  const next = THEMES[(i + 1) % THEMES.length];
  const Current = THEMES[i].icon;
  return (
    <button className="btn-ghost h-9 w-9 p-0" onClick={() => setTheme(next.value)} aria-label={`Theme: ${THEMES[i].label}. Switch to ${next.label}`} title={`Theme: ${THEMES[i].label}`}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={theme} initial={{ rotate: -90, opacity: 0, scale: 0.6 }} animate={{ rotate: 0, opacity: 1, scale: 1 }} exit={{ rotate: 90, opacity: 0, scale: 0.6 }} transition={{ duration: 0.2 }}>
          <Current size={17} />
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

const NOTICE_DOT: Record<Notice["kind"], string> = {
  risky: "var(--warning)",
  fixes: "var(--accent)",
  test: "var(--good)",
  regression: "var(--critical)",
  batch: "var(--accent-2)",
  prompt: "var(--type-knowledge)",
};

function NotificationBell() {
  const { notices, markAllRead, clearNotices } = useUi();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const unread = notices.filter((n) => !n.read).length;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        className="btn-ghost relative h-9 w-9 p-0"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (!open) setTimeout(markAllRead, 1200);
        }}
      >
        <motion.span key={unread} animate={unread ? { rotate: [0, -14, 12, -8, 6, 0] } : {}} transition={{ duration: 0.6 }}>
          <Bell size={17} />
        </motion.span>
        <AnimatePresence>
          {unread > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="tnum absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[10px] font-bold text-white"
              style={{ background: "var(--critical)" }}
            >
              {unread > 9 ? "9+" : unread}
            </motion.span>
          )}
        </AnimatePresence>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className="absolute right-0 top-11 z-50 w-[min(360px,calc(100vw-32px))] origin-top-right overflow-hidden rounded-2xl border border-line bg-s1 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="text-sm font-semibold">Notifications</span>
              {notices.length > 0 && (
                <button className="text-xs text-t2 hover:text-t1" onClick={clearNotices}>
                  Clear all
                </button>
              )}
            </div>
            <ul className="max-h-[60vh] overflow-y-auto">
              {notices.length === 0 && <li className="px-4 py-10 text-center text-sm text-tm">You're all caught up.</li>}
              {notices.map((n, i) => (
                <motion.li key={n.id} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.02 }}>
                  <button
                    className="flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-s2"
                    onClick={() => {
                      if (n.to) nav(n.to);
                      setOpen(false);
                    }}
                  >
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: NOTICE_DOT[n.kind] }} />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-sm", n.read ? "text-t2" : "font-medium text-t1")}>{n.title}</span>
                      {n.body && <span className="block truncate text-xs text-tm">{n.body}</span>}
                    </span>
                    <span className="shrink-0 text-[11px] text-tm">{timeAgo(n.at)}</span>
                  </button>
                </motion.li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Header() {
  const { data: pipeline } = usePipeline();
  const setUploadOpen = useUi((s) => s.setUploadOpen);
  const qc = useQueryClient();
  const nav = useNavigate();
  const busy = pipeline && ["processing", "clustering", "fixing", "testing", "queued"].includes(pipeline.stage);

  return (
    <header className="glass sticky top-0 z-40 border-b border-line">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-3 px-4 sm:px-6">
        <Logo />
        <div className="ml-1 min-w-0 sm:ml-4">
          <PipelineChip pipeline={pipeline} />
        </div>
        {isMock && (
          <span className="chip hidden border border-dashed border-line text-tm lg:inline-flex" title="Running the in-browser simulated pipeline (VITE_MOCK=1)">
            Demo data
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {isMock && api.reset && (
            <button
              className="btn-ghost hidden h-9 w-9 p-0 sm:inline-flex"
              title="Reset demo"
              aria-label="Reset demo"
              disabled={busy}
              onClick={async () => {
                await api.reset!();
                useUi.getState().clearNotices();
                qc.invalidateQueries();
                nav("/audit");
              }}
            >
              <RotateCcw size={16} />
            </button>
          )}
          <NotificationBell />
          <ThemeToggle />
          <button className="btn-primary ml-1.5" onClick={() => setUploadOpen(true)} disabled={busy}>
            <UploadCloud size={16} />
            <span className="hidden sm:inline">Upload recordings</span>
          </button>
        </div>
      </div>
      <PipelineProgressLine pipeline={pipeline} />
    </header>
  );
}
