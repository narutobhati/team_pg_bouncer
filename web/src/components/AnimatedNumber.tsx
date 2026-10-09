import { animate } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/lib/util";

interface Props {
  value: number;
  format?: (n: number) => string;
  duration?: number;
  className?: string;
}

/** Counts from the previously rendered value to the new one. */
export function AnimatedNumber({ value, format = (n) => Math.round(n).toLocaleString(), duration = 0.6, className }: Props) {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(value);
  const prev = useRef(value);

  useEffect(() => {
    if (reduced) {
      setShown(value);
      prev.current = value;
      return;
    }
    const controls = animate(prev.current, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: setShown,
    });
    prev.current = value;
    return () => controls.stop();
  }, [value, duration, reduced]);

  return <span className={className}>{format(shown)}</span>;
}
