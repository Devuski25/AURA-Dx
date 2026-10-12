import { useEffect, useRef } from "react"
import { animate, motion, useInView, useMotionValue, useReducedMotion, useTransform } from "framer-motion"
import { EASE_OUT } from "@/lib/fine-motion"

/** Counts from 0 to `to` when scrolled into view. */
export function CountUp({ to, suffix = "", duration = 1.6, delay = 0, className }: { to: number; suffix?: string; duration?: number; delay?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const reduce = useReducedMotion()
  const inView = useInView(ref, { once: true, amount: 0.6 })
  const value = useMotionValue(reduce ? to : 0)
  const text = useTransform(value, (v) => `${Math.round(v)}${suffix}`)

  useEffect(() => {
    if (!inView || reduce) return
    const controls = animate(value, to, { duration, delay, ease: EASE_OUT })
    return () => controls.stop()
  }, [inView, reduce, to, duration, delay, value])

  return <motion.span ref={ref} className={className}>{text}</motion.span>
}
