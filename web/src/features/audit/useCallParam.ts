import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

/** The open call drawer lives in the URL (?call=42) so any tab, notification or link can open it. */
export function useCallParam() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("call");
  const callId = raw ? Number(raw) : null;
  const open = useCallback(
    (id: number | null) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id == null) next.delete("call");
          else next.set("call", String(id));
          return next;
        },
        { replace: id == null },
      ),
    [setParams],
  );
  return [callId, open] as const;
}
