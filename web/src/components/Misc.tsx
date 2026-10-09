import { motion } from "framer-motion";
import { Lock, UploadCloud, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/util";
import { useUi } from "@/store/ui";

export function SectionTitle({ title, subtitle, right }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-t1">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-t2">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function EmptyState({
  icon: Icon = Lock,
  title,
  body,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("card relative flex flex-col items-center overflow-hidden px-6 py-16 text-center", className)}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-40 opacity-70"
        style={{ background: "radial-gradient(50% 100% at 50% 0%, var(--accent-soft), transparent)" }}
      />
      <div className="relative mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-line bg-s2">
        <Icon size={24} className="text-accent" />
      </div>
      <h3 className="relative text-base font-semibold">{title}</h3>
      {body && <p className="relative mt-1.5 max-w-md text-sm text-t2">{body}</p>}
      {action && <div className="relative mt-5">{action}</div>}
    </motion.div>
  );
}

export function UploadCta() {
  const setUploadOpen = useUi((s) => s.setUploadOpen);
  return (
    <button className="btn-primary" onClick={() => setUploadOpen(true)}>
      <UploadCloud size={16} /> Upload recordings
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  layoutId,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  layoutId: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" className="inline-flex rounded-xl border border-line bg-s2 p-0.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative rounded-[10px] font-medium transition-colors",
              size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
              on ? "text-t1" : "text-t2 hover:text-t1",
            )}
          >
            {on && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-[10px] border border-line bg-s1 shadow-card"
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
              />
            )}
            <span className="relative flex items-center gap-1.5">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "good" | "crit" | "warn" }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div
        className={cn(
          "mt-1 text-lg font-semibold",
          tone === "good" && "text-[color:var(--good-text)]",
          tone === "crit" && "text-[color:var(--critical-text)]",
          tone === "warn" && "text-[color:var(--warning-text)]",
        )}
      >
        {value}
      </div>
    </div>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-2.5 text-sm text-t1">
      <span className="relative grid h-[18px] w-[18px] place-items-center">
        <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="absolute inset-0 rounded-md border border-[color:var(--border-strong)] bg-s1 transition-colors peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent" />
        <motion.svg viewBox="0 0 12 12" className="relative h-3 w-3" initial={false} animate={{ opacity: checked ? 1 : 0 }}>
          <motion.path
            d="M2.5 6.2l2.3 2.3 4.7-5"
            fill="none"
            stroke="white"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={false}
            animate={{ pathLength: checked ? 1 : 0 }}
            transition={{ duration: 0.2 }}
          />
        </motion.svg>
      </span>
      {label}
    </label>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="flex cursor-pointer select-none items-center justify-between gap-3 text-sm text-t1">
      {label}
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn("relative h-5 w-9 rounded-full transition-colors", checked ? "bg-accent" : "bg-s3")}
      >
        <motion.span
          className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow"
          animate={{ left: checked ? 18 : 2 }}
          transition={{ type: "spring", stiffness: 600, damping: 35 }}
        />
      </button>
    </label>
  );
}
