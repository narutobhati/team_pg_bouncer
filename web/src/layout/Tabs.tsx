import { AnimatePresence, motion } from "framer-motion";
import { FlaskConical, History, Layers, ListChecks, Lock, Wrench, type LucideIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useFixes, useRootCauses, useTests } from "@/api/hooks";
import { cn } from "@/lib/util";
import { Tooltip } from "@/components/Tooltip";

interface TabDef {
  to: string;
  label: string;
  icon: LucideIcon;
  locked: boolean;
  lockHint: string;
  count?: number;
  attention?: boolean;
}

export function Tabs() {
  const { data: rcs = [] } = useRootCauses();
  const { data: fixes = [] } = useFixes();
  const { data: tests = [] } = useTests();
  const loc = useLocation();
  const pending = fixes.filter((f) => f.status === "Pending Review").length;
  const approved = fixes.some((f) => f.status !== "Pending Review" && f.status !== "Rejected");

  const tabs: TabDef[] = [
    { to: "/audit", label: "Audit", icon: ListChecks, locked: false, lockHint: "" },
    { to: "/issues", label: "Issues", icon: Layers, locked: rcs.length === 0, lockHint: "Unlocks when a batch finishes clustering", count: rcs.length || undefined },
    { to: "/fix", label: "Fix", icon: Wrench, locked: fixes.length === 0, lockHint: "Unlocks when prompt fixes are drafted", count: pending || undefined, attention: pending > 0 },
    { to: "/test", label: "Test", icon: FlaskConical, locked: !approved && tests.length === 0, lockHint: "Unlocks after you approve a fix", count: tests.length || undefined },
    { to: "/history", label: "Prompt History", icon: History, locked: false, lockHint: "" },
  ];

  return (
    <nav aria-label="Sections" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b border-line">
        {tabs.map((t) => (
          <TabItem key={t.to} tab={t} active={loc.pathname.startsWith(t.to)} />
        ))}
      </ul>
    </nav>
  );
}

function TabItem({ tab, active }: { tab: TabDef; active: boolean }) {
  const wasLocked = useRef(tab.locked);
  const justUnlocked = wasLocked.current && !tab.locked;
  useEffect(() => {
    wasLocked.current = tab.locked;
  }, [tab.locked]);
  const Icon = tab.icon;

  const inner = (
    <span className="relative flex items-center gap-2 px-3 py-3 text-sm font-medium sm:px-4">
      <AnimatePresence mode="wait" initial={false}>
        {tab.locked ? (
          <motion.span key="lock" exit={{ rotate: -30, scale: 0, opacity: 0 }}>
            <Lock size={14} />
          </motion.span>
        ) : (
          <motion.span key="icon" initial={{ scale: 0, rotate: 30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 500, damping: 20 }}>
            <Icon size={15} />
          </motion.span>
        )}
      </AnimatePresence>
      {tab.label}
      {tab.count != null && (
        <motion.span
          key={tab.count}
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className={cn(
            "tnum grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-semibold",
            tab.attention ? "text-white" : "bg-s2 text-t2",
          )}
          style={tab.attention ? { background: "var(--accent)" } : undefined}
        >
          {tab.count}
        </motion.span>
      )}
      {justUnlocked && (
        <motion.span
          className="pointer-events-none absolute inset-0 rounded-lg"
          initial={{ opacity: 0.7, boxShadow: "0 0 0 0 var(--accent)" }}
          animate={{ opacity: 0, boxShadow: "0 0 24px 6px var(--accent)" }}
          transition={{ duration: 1.2 }}
        />
      )}
      {active && (
        <motion.span
          layoutId="tab-underline"
          className="absolute inset-x-2 -bottom-px h-[2px] rounded-full"
          style={{ background: "linear-gradient(90deg, var(--accent), var(--accent-2))" }}
          transition={{ type: "spring", stiffness: 500, damping: 40 }}
        />
      )}
    </span>
  );

  if (tab.locked)
    return (
      <li>
        <Tooltip content={tab.lockHint} side="bottom">
          <span className="block cursor-not-allowed text-tm" aria-disabled="true" tabIndex={0}>
            {inner}
          </span>
        </Tooltip>
      </li>
    );

  return (
    <li>
      <NavLink to={tab.to} className={cn("block rounded-t-lg transition-colors", active ? "text-t1" : "text-t2 hover:text-t1")}>
        {inner}
      </NavLink>
    </li>
  );
}
