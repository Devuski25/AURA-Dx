import type { Variants } from "framer-motion"

/* Shared entrance choreography for the Login and Register cards, so the two
   pages animate identically. Both pages pass `initial={false}` under reduced
   motion, which makes Framer render the `visible` state on the first frame. */

const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1]

/** The card: one 16px rise, 0.6s, ease-out. */
export const authCardVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE_OUT } },
}

/** Fields trail the card by 0.18s, then arrive 0.06s apart. */
export const authFieldGroupVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.18 } },
}

/**
 * For forms with many fields. At 0.06s a twelve-item cascade would not finish
 * until 1.2s, so the dense variant tightens the step to keep the whole
 * sequence landing around 0.85s.
 */
export const authFieldGroupDenseVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.03, delayChildren: 0.12 } },
}

export const authFieldVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE_OUT } },
}