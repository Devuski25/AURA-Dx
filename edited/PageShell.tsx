import type { ReactNode } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { EASE_OUT } from "@/lib/fine-motion"
import { ScrollProgress } from "@/components/ScrollProgress"

/** Wrap each page: soft fade-in on route change plus the thin reading-progress line. */
export function PageShell({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion()
  return (
    <motion.div initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.7, ease: EASE_OUT }}>
      <ScrollProgress />
      {children}
    </motion.div>
  )
}
