import type { Transition, Variants } from "framer-motion";

export const ease = [0.22, 1, 0.36, 1] as const;
export const spring: Transition = { type: "spring", stiffness: 380, damping: 32 };
export const softSpring: Transition = { type: "spring", stiffness: 200, damping: 26 };

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease } },
};

export const stagger = (s = 0.05, delay = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: s, delayChildren: delay } },
});

export const page: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.28, ease } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.16, ease } },
};
