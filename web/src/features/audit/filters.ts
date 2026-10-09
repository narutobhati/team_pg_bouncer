import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { Call, Category, Grade } from "@/types/api";

export interface AuditFilters {
  grade: Grade | "all";
  risky: boolean;
  categories: Category[];
  lang: string;
  prompt: string;
  batch: string;
  rc: string;
  confMin: number;
  confMax: number;
  q: string;
}

export type SortKey = "id" | "duration_sec" | "grade" | "overall_confidence" | "language" | "prompt_version";

/** Filters are URL state so every drill-down link ("Fatal", "Risky", "View all calls") is shareable. */
export function useAuditFilters() {
  const [params, setParams] = useSearchParams();
  const filters: AuditFilters = useMemo(
    () => ({
      grade: (params.get("grade") as Grade) || "all",
      risky: params.get("risky") === "1",
      categories: (params.get("cat")?.split(",").filter(Boolean) as Category[]) ?? [],
      lang: params.get("lang") ?? "",
      prompt: params.get("prompt") ?? "",
      batch: params.get("batch") ?? "",
      rc: params.get("rc") ?? "",
      confMin: Number(params.get("cmin") ?? 0),
      confMax: Number(params.get("cmax") ?? 1),
      q: params.get("q") ?? "",
    }),
    [params],
  );

  const set = (patch: Partial<AuditFilters>) =>
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        const f = { ...filters, ...patch };
        const put = (k: string, v: string | null) => (v ? n.set(k, v) : n.delete(k));
        put("grade", f.grade === "all" ? null : f.grade);
        put("risky", f.risky ? "1" : null);
        put("cat", f.categories.join(",") || null);
        put("lang", f.lang || null);
        put("prompt", f.prompt || null);
        put("batch", f.batch || null);
        put("rc", f.rc || null);
        put("cmin", f.confMin > 0 ? String(f.confMin) : null);
        put("cmax", f.confMax < 1 ? String(f.confMax) : null);
        put("q", f.q || null);
        return n;
      },
      { replace: true },
    );

  const clear = () =>
    setParams(
      (prev) => {
        const n = new URLSearchParams();
        const call = prev.get("call");
        if (call) n.set("call", call);
        return n;
      },
      { replace: true },
    );

  const active =
    (filters.grade !== "all" ? 1 : 0) +
    (filters.risky ? 1 : 0) +
    filters.categories.length +
    (filters.lang ? 1 : 0) +
    (filters.prompt ? 1 : 0) +
    (filters.batch ? 1 : 0) +
    (filters.rc ? 1 : 0) +
    (filters.confMin > 0 || filters.confMax < 1 ? 1 : 0) +
    (filters.q ? 1 : 0);

  return { filters, set, clear, active };
}

export function applyFilters(calls: Call[], f: AuditFilters): Call[] {
  const q = f.q.trim().toLowerCase();
  return calls.filter(
    (c) =>
      (f.grade === "all" || c.grade === f.grade) &&
      (!f.risky || c.risky_flags.length > 0) &&
      (!f.categories.length || (c.category && f.categories.includes(c.category))) &&
      (!f.lang || c.language === f.lang) &&
      (!f.prompt || c.prompt_version === f.prompt) &&
      (!f.batch || String(c.batch_id) === f.batch) &&
      (!f.rc || String(c.root_cause_id) === f.rc) &&
      c.overall_confidence >= f.confMin &&
      c.overall_confidence <= f.confMax &&
      (!q || c.call_id.toLowerCase().includes(q) || c.reason.toLowerCase().includes(q) || c.file_name.toLowerCase().includes(q)),
  );
}
