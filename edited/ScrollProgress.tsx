import { motion, useReducedMotion, useScroll, useSpring } from "framer-motion"

/** Thin reading-progress line at the top of the screen. Render once, outside any transformed element. */
export function ScrollProgress() {
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 30, restDelta: 0.001 })
  if (reduce) return null
  return (
    <motion.div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[3px] origin-left bg-gradient-to-r from-aura-accent to-aura-mint"
      style={{ scaleX }}
    />
  )
}
