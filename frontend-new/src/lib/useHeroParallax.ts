import { useRef } from "react"
import { useReducedMotion, useScroll, useSpring, useTransform } from "framer-motion"

/** Hero content drifts down and dims slowly as you scroll away; spring-smoothed so it never jitters. */
export function useHeroParallax() {
  const ref = useRef<HTMLElement | null>(null)
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] })
  const y = useSpring(useTransform(scrollYProgress, [0, 1], [0, 70]), { stiffness: 90, damping: 28, mass: 0.6 })
  const opacity = useTransform(scrollYProgress, [0, 0.75], [1, 0.25])
  return { ref, style: reduce ? undefined : { y, opacity } }
}
