import type { ApiClient, CreateBatchInput } from "./client";
import type { ServerEvent } from "@/types/api";

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = await res.json();
      msg = body.error ?? body.message ?? msg;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const json = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

const EVENT_TYPES: ServerEvent["type"][] = [
  "batch.created",
  "batch.progress",
  "call.graded",
  "call.updated",
  "root_causes.ready",
  "fixes.ready",
  "prompt.created",
  "test.done",
  "regression",
];

export function createHttpClient(): ApiClient {
  return {
    mode: "http",
    getPipeline: () => request("/api/pipeline"),
    listBatches: () => request("/api/batches"),
    createBatch: ({ files, label }: CreateBatchInput) => {
      const fd = new FormData();
      files.forEach((f) => fd.append("files", f, f.name));
      fd.append("label", label);
      return request("/api/batches", { method: "POST", body: fd });
    },
    listCalls: () => request("/api/calls"),
    getCall: (id) => request(`/api/calls/${id}`),
    markReviewed: (id) => request(`/api/calls/${id}/review`, { method: "POST" }),
    replayCall: (id) => request(`/api/calls/${id}/replay`, { method: "POST" }),
    listRootCauses: () => request("/api/root-causes"),
    listFixes: () => request("/api/fixes"),
    approveFixes: (ids, edits) => request("/api/fixes/approve", json({ ids, edits })),
    rejectFix: (id) => request(`/api/fixes/${id}/reject`, { method: "POST" }),
    previewPrompt: (ids, edits) => request("/api/fixes/preview", json({ ids, edits })),
    listTests: () => request("/api/tests"),
    listReplayedCalls: (fixId) => request(`/api/tests/${fixId}/calls`),
    listPrompts: () => request("/api/prompts"),
    listRegressions: () => request("/api/regressions"),
    subscribe(handler) {
      // Server-Sent Events; each event's `event:` name is the ServerEvent type and `data:` is its JSON.
      const es = new EventSource(`${BASE}/api/events`);
      const listeners = EVENT_TYPES.map((type) => {
        const fn = (msg: MessageEvent) => {
          try {
            handler({ type, ...JSON.parse(msg.data) } as ServerEvent);
          } catch (err) {
            console.error("bad SSE payload", type, err);
          }
        };
        es.addEventListener(type, fn);
        return [type, fn] as const;
      });
      return () => {
        listeners.forEach(([type, fn]) => es.removeEventListener(type, fn));
        es.close();
      };
    },
  };
}
