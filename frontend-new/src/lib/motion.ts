import { type Variants, type Transition } from "framer-motion"

export const spring = {
  gentle: { type: "spring", stiffness: 120, damping: 14, mass: 0.8 } satisfies Transition,
  snappy: { type: "spring", stiffness: 300, damping: 24, mass: 0.5 } satisfies Transition,
  bouncy: { type: "spring", stiffness: 200, damping: 10, mass: 0.6 } satisfies Transition,
  slow: { type: "spring", stiffness: 80, damping: 20, mass: 1 } satisfies Transition,
}

export const pageVariants: Variants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: spring.gentle },
  exit: { opacity: 0, y: -8, transition: { duration: 0.15, ease: "easeInOut" } },
}

export const cardHover = {
  whileHover: { y: -4, boxShadow: "var(--shadow-cough-lg)", transition: spring.snappy },
  whileTap: { scale: 0.98 },
}

export const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.08 } },
}

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: spring.gentle },
}

export const sidebarVariants: Variants = {
  open: { x: 0, transition: spring.gentle },
  closed: { x: "-100%", transition: { duration: 0.2, ease: "easeInOut" } },
}

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: spring.gentle },
}

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.95, y: 10 },
  visible: { opacity: 1, scale: 1, y: 0, transition: spring.snappy },
  exit: { opacity: 0, scale: 0.97, transition: { duration: 0.12 } },
}
