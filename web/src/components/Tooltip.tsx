import { AnimatePresence, motion } from "framer-motion";
import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/util";

interface Props {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom";
  className?: string;
  wide?: boolean;
}

/** Hover + keyboard-focus tooltip. */
export function Tooltip({ content, children, side = "top", className, wide }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span
      className={cn("relative inline-flex", className)}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      aria-describedby={open ? id : undefined}
    >
      {children}
      <AnimatePresence>
        {open && (
          <motion.span
            id={id}
            role="tooltip"
            initial={{ opacity: 0, y: side === "top" ? 4 : -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            transition={{ duration: 0.15 }}
            className={cn(
              "pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 rounded-lg border border-line bg-s1 px-2.5 py-1.5 text-xs font-medium text-t1 shadow-card",
              wide ? "w-64 whitespace-normal" : "whitespace-nowrap",
              side === "top" ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]",
            )}
          >
            {content}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
