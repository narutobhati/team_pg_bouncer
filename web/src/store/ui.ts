import { create } from "zustand";

export type Theme = "light" | "dark" | "system";

export interface Notice {
  id: string;
  kind: "risky" | "fixes" | "test" | "regression" | "batch" | "prompt";
  title: string;
  body?: string;
  to?: string;
  at: number;
  read: boolean;
}

interface UiState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  /** Batch scope for the summary bar and Issues tab; "latest" follows new uploads. */
  scope: number | "latest" | "all";
  setScope: (s: UiState["scope"]) => void;
  uploadOpen: boolean;
  setUploadOpen: (o: boolean) => void;
  notices: Notice[];
  notify: (n: Omit<Notice, "id" | "at" | "read">) => void;
  markAllRead: () => void;
  clearNotices: () => void;
  /** Call ids that arrived in the last moments, for the live-row highlight. */
  fresh: Set<number>;
  markFresh: (id: number) => void;
}

const readTheme = (): Theme => {
  try {
    const t = localStorage.getItem("cal-theme");
    if (t === "light" || t === "dark") return t;
  } catch {
    /* storage blocked */
  }
  return "system";
};

export const applyTheme = (t: Theme) => {
  const root = document.documentElement;
  if (t === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
  try {
    if (t === "system") localStorage.removeItem("cal-theme");
    else localStorage.setItem("cal-theme", t);
  } catch {
    /* storage blocked */
  }
};

let noticeSeq = 0;

export const useUi = create<UiState>((set, get) => ({
  theme: readTheme(),
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
  scope: "latest",
  setScope: (scope) => set({ scope }),
  uploadOpen: false,
  setUploadOpen: (uploadOpen) => set({ uploadOpen }),
  notices: [],
  notify: (n) =>
    set({
      notices: [{ ...n, id: `n${++noticeSeq}`, at: Date.now(), read: false }, ...get().notices].slice(0, 40),
    }),
  markAllRead: () => set({ notices: get().notices.map((n) => ({ ...n, read: true })) }),
  clearNotices: () => set({ notices: [] }),
  fresh: new Set(),
  markFresh: (id) => {
    const fresh = new Set(get().fresh);
    fresh.add(id);
    set({ fresh });
    setTimeout(() => {
      const next = new Set(get().fresh);
      next.delete(id);
      set({ fresh: next });
    }, 1600);
  },
}));

export const prefersDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
export const isDark = (t: Theme) => t === "dark" || (t === "system" && prefersDark());
