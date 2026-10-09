import {
  AlertTriangle,
  AudioWaveform,
  CheckCircle2,
  CircleDashed,
  Frown,
  Repeat,
  ShieldCheck,
  Target,
  UserRound,
  Wrench,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { FixStatus, Grade, RiskFlag, RootCauseType } from "@/types/api";
import { cn, humanize } from "@/lib/util";
import { Tooltip } from "./Tooltip";

const tint = (v: string, a = 14) => `color-mix(in srgb, var(${v}) ${a}%, transparent)`;

function Tinted({ color, icon: Icon, children, className, dot }: { color: string; icon?: LucideIcon; children: React.ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("chip whitespace-nowrap text-t1", className)} style={{ background: tint(color) }}>
      {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ background: `var(${color})` }} />}
      {Icon && <Icon size={13} strokeWidth={2.2} style={{ color: `var(${color})` }} aria-hidden />}
      {children}
    </span>
  );
}

export function GradeBadge({ grade, className }: { grade: Grade; className?: string }) {
  return grade === "Fatal" ? (
    <Tinted color="--critical" icon={XCircle} className={className}>
      Fatal
    </Tinted>
  ) : (
    <Tinted color="--good" icon={CheckCircle2} className={className}>
      Non-Fatal
    </Tinted>
  );
}

const TYPE_VAR: Record<RootCauseType, string> = {
  "Prompt Issue": "--type-prompt",
  "ASR Issue": "--type-asr",
  "Knowledge Gap": "--type-knowledge",
  "Flow Logic": "--type-flow",
};
export const typeColor = (t: RootCauseType) => `var(${TYPE_VAR[t]})`;

export function TypeBadge({ type }: { type: RootCauseType }) {
  return (
    <Tinted color={TYPE_VAR[type]} dot>
      {type}
    </Tinted>
  );
}

const FIX_STATUS: Record<FixStatus, { color: string; icon: LucideIcon }> = {
  "Pending Review": { color: "--warning", icon: CircleDashed },
  Approved: { color: "--accent", icon: Wrench },
  Rejected: { color: "--text-muted", icon: XCircle },
  Validated: { color: "--good", icon: ShieldCheck },
  "Needs Revision": { color: "--serious", icon: AlertTriangle },
};

export function FixStatusBadge({ status }: { status: FixStatus }) {
  const s = FIX_STATUS[status];
  return (
    <Tinted color={s.color} icon={s.icon}>
      {status}
    </Tinted>
  );
}

export function VersionChip({ v, active }: { v: string; active?: boolean }) {
  return (
    <span
      className={cn(
        "chip font-mono text-[11px]",
        active ? "bg-accent-soft text-accent" : "bg-s2 text-t2",
      )}
    >
      {v}
      {active && <span className="h-1.5 w-1.5 rounded-full bg-accent pulse-dot" />}
    </span>
  );
}

export const FLAG_META: Record<RiskFlag, { icon: LucideIcon; label: string }> = {
  frustration: { icon: Frown, label: "Frustration" },
  loop: { icon: Repeat, label: "Bot loop" },
  human_request: { icon: UserRound, label: "Asked for human" },
  low_confidence: { icon: AudioWaveform, label: "Low ASR confidence" },
  wrong_capture: { icon: Target, label: "Wrong capture" },
};

export function RiskyFlags({ flags, showLabel }: { flags: RiskFlag[]; showLabel?: boolean }) {
  if (!flags.length) return <span className="text-tm">—</span>;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {flags.map((f) => {
        const { icon: Icon, label } = FLAG_META[f];
        return showLabel ? (
          <Tinted key={f} color="--warning" icon={Icon}>
            {label}
          </Tinted>
        ) : (
          <Tooltip key={f} content={label}>
            <span
              className="grid h-6 w-6 place-items-center rounded-lg"
              style={{ background: tint("--warning", 16) }}
              aria-label={label}
              role="img"
            >
              <Icon size={13} strokeWidth={2.2} style={{ color: "var(--warning-text)" }} />
            </span>
          </Tooltip>
        );
      })}
    </span>
  );
}

export function CategoryTag({ category }: { category?: string }) {
  if (!category) return <span className="text-tm">—</span>;
  return <span className="chip bg-s2 font-mono text-[11px] text-t2">{humanize(category)}</span>;
}
