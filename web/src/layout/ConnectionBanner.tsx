import { AnimatePresence, motion } from "framer-motion";
import { WifiOff } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { usePipeline } from "@/api/hooks";
import { isMock } from "@/api";

/** Shown when the Go API is unreachable, with a hint to run the demo pipeline instead. */
export function ConnectionBanner() {
  const { isError, error } = usePipeline();
  const qc = useQueryClient();
  const show = !isMock && isError;
  return (
    <AnimatePresence>
      {show && (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
          <div className="mx-auto mt-4 flex max-w-[1440px] items-center gap-3 px-4 sm:px-6">
            <div
              className="flex w-full flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm"
              style={{ borderColor: "color-mix(in srgb, var(--critical) 35%, transparent)", background: "color-mix(in srgb, var(--critical) 8%, transparent)" }}
            >
              <WifiOff size={16} style={{ color: "var(--critical)" }} />
              <span className="text-t1">
                Can't reach the API{error instanceof Error ? ` (${error.message})` : ""}. Start the Go server, or run <code className="font-mono text-xs">npm run dev:mock</code> for the simulated pipeline.
              </span>
              <button className="btn-outline ml-auto px-3 py-1 text-xs" onClick={() => qc.invalidateQueries()}>
                Retry
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
