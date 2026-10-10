import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from ".";
import type { Call, Pipeline, ServerEvent } from "@/types/api";
import { useUi } from "@/store/ui";
import type { CreateBatchInput } from "./client";

export const qk = {
  pipeline: ["pipeline"] as const,
  batches: ["batches"] as const,
  calls: ["calls"] as const,
  rootCauses: ["root-causes"] as const,
  fixes: ["fixes"] as const,
  tests: ["tests"] as const,
  prompts: ["prompts"] as const,
  regressions: ["regressions"] as const,
  replayed: (fixId: number) => ["replayed", fixId] as const,
};

export const usePipeline = () => useQuery({ queryKey: qk.pipeline, queryFn: () => api.getPipeline() });
export const useBatches = () => useQuery({ queryKey: qk.batches, queryFn: () => api.listBatches() });
export const useCalls = () => useQuery({ queryKey: qk.calls, queryFn: () => api.listCalls() });
export const useRootCauses = () => useQuery({ queryKey: qk.rootCauses, queryFn: () => api.listRootCauses() });
export const useFixes = () => useQuery({ queryKey: qk.fixes, queryFn: () => api.listFixes() });
export const useTests = () => useQuery({ queryKey: qk.tests, queryFn: () => api.listTests() });
export const usePrompts = () => useQuery({ queryKey: qk.prompts, queryFn: () => api.listPrompts() });
export const useRegressions = () => useQuery({ queryKey: qk.regressions, queryFn: () => api.listRegressions() });
export const useReplayed = (fixId: number | null) =>
  useQuery({ queryKey: qk.replayed(fixId ?? -1), queryFn: () => api.listReplayedCalls(fixId!), enabled: fixId != null });

/** Resolve the UI batch scope to a concrete batch id (or null for all batches). */
export function useScopeBatchId(): number | null {
  const scope = useUi((s) => s.scope);
  const { data: batches } = useBatches();
  if (scope === "all") return null;
  if (scope === "latest") return batches?.length ? batches[batches.length - 1].id : null;
  return scope;
}

export function useScopedCalls() {
  const { data: calls = [] } = useCalls();
  const batchId = useScopeBatchId();
  return useMemo(() => (batchId == null ? calls : calls.filter((c) => c.batch_id === batchId)), [calls, batchId]);
}

export function useScopedRootCauses() {
  const { data: rcs = [] } = useRootCauses();
  const batchId = useScopeBatchId();
  return useMemo(
    () =>
      (batchId == null ? rcs : rcs.filter((r) => r.batch_id === batchId))
        .slice()
        .sort((a, b) => b.priority_score - a.priority_score),
    [rcs, batchId],
  );
}

const upsertCall = (qc: QueryClient, call: Call) =>
  qc.setQueryData<Call[]>(qk.calls, (prev = []) => {
    const i = prev.findIndex((c) => c.id === call.id);
    if (i === -1) return [...prev, call];
    const next = prev.slice();
    next[i] = call;
    return next;
  });

/** Bridge server events into the query cache and the notification panel. Mount once. */
export function useLiveEvents() {
  const qc = useQueryClient();

  useEffect(() => {
    const { notify, markFresh, setFileProgress } = useUi.getState();
    const handle = (e: ServerEvent) => {
      switch (e.type) {
        case "batch.file_progress":
          setFileProgress({ file: e.file, step: e.step });
          break;
        case "batch.created":
          qc.invalidateQueries({ queryKey: qk.batches });
          useUi.getState().setScope("latest");
          notify({
            kind: "batch",
            title: `Batch #${e.batch.id} queued`,
            body: `${e.batch.total} calls · Prompt ${e.batch.prompt_version}`,
            to: "/audit",
          });
          break;
        case "batch.progress":
          qc.setQueryData<Pipeline>(qk.pipeline, e.pipeline);
          if (e.pipeline.stage !== "processing") {
            qc.invalidateQueries({ queryKey: qk.batches });
            useUi.getState().setFileProgress(null);
          }
          break;
        case "call.graded":
          upsertCall(qc, e.call);
          markFresh(e.call.id);
          if (e.call.risky_flags.length >= 2)
            notify({
              kind: "risky",
              title: `Risky call ${e.call.call_id}`,
              body: e.call.risky_flags.join(" · ").replace(/_/g, " "),
              to: `/audit?call=${e.call.id}`,
            });
          break;
        case "call.updated":
          upsertCall(qc, e.call);
          break;
        case "root_causes.ready":
          qc.invalidateQueries({ queryKey: qk.rootCauses });
          qc.invalidateQueries({ queryKey: qk.calls });
          qc.invalidateQueries({ queryKey: qk.prompts });
          notify({ kind: "batch", title: `${e.count} root causes found`, body: `Batch #${e.batch_id} clustered`, to: "/issues" });
          break;
        case "fixes.ready":
          qc.invalidateQueries({ queryKey: qk.fixes });
          notify({ kind: "fixes", title: `${e.count} prompt fixes ready for review`, to: "/fix" });
          break;
        case "prompt.created":
          qc.invalidateQueries({ queryKey: qk.prompts });
          qc.invalidateQueries({ queryKey: qk.fixes });
          qc.invalidateQueries({ queryKey: qk.rootCauses });
          notify({ kind: "prompt", title: `Prompt ${e.version} created`, body: "Replay simulation running…", to: "/history" });
          break;
        case "test.done":
          qc.invalidateQueries({ queryKey: qk.tests });
          qc.invalidateQueries({ queryKey: qk.fixes });
          qc.invalidateQueries({ queryKey: qk.calls });
          qc.invalidateQueries({ queryKey: qk.prompts });
          notify({
            kind: "test",
            title: `${e.results.length} fix test${e.results.length > 1 ? "s" : ""} complete`,
            body: e.results.map((r) => `${r.repaired}/${r.before_fatal} repaired`).join(" · "),
            to: "/test",
          });
          break;
        case "regression":
          qc.invalidateQueries({ queryKey: qk.regressions });
          notify({
            kind: "regression",
            title: "Regression detected",
            body: `"${e.regression.root_cause_name}" is back at ${Math.round(e.regression.frequency * 100)}%`,
            to: "/test",
          });
          break;
      }
    };
    return api.subscribe(handle);
  }, [qc]);
}

export function useCreateBatch() {
  return useMutation({ mutationFn: (input: CreateBatchInput) => api.createBatch(input) });
}

export function useMarkReviewed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.markReviewed(id),
    onSuccess: (call) => upsertCall(qc, call),
  });
}

export function useVerifyCall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.verifyCall(id),
    onSuccess: (call) => upsertCall(qc, call),
  });
}

export function useRerunCall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.rerunCall(id),
    onSuccess: (call) => upsertCall(qc, call),
  });
}

export function useReplayCall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.replayCall(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.calls }),
  });
}

export function useApproveFixes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, edits }: { ids: number[]; edits: Record<number, string> }) => api.approveFixes(ids, edits),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.fixes });
      qc.invalidateQueries({ queryKey: qk.prompts });
      qc.invalidateQueries({ queryKey: qk.rootCauses });
      qc.invalidateQueries({ queryKey: qk.pipeline });
    },
  });
}

export function useRejectFix() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.rejectFix(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.fixes }),
  });
}

export function useGenerateFix() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rcId: number) => api.generateFix(rcId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.fixes }),
  });
}

export function useRetestFix() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fixId: number) => api.retestFix(fixId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.fixes });
      qc.invalidateQueries({ queryKey: qk.tests });
    },
  });
}
