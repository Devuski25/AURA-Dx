import type { ReactNode } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { EASE_OUT, VIEWPORT } from "@/lib/fine-motion"
import { cn } from "@/lib/utils"

/** One h2 style for every page; it rises out of a soft blur as it scrolls in. */
export function SectionHeading({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion()
  return (
    <motion.h2
      className={cn("font-display text-[1.65rem] font-bold leading-tight tracking-tight text-aura-text md:text-[2rem]", className)}
      initial={reduce ? false : { opacity: 0, y: 26, filter: "blur(6px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } }}
      viewport={VIEWPORT}
      transition={{ duration: 1, ease: EASE_OUT }}
    >
      {children}
    </motion.h2>
  )
}
