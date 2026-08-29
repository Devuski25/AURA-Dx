import { useEffect, useState } from "react"
import { animate, useReducedMotion } from "framer-motion"

/**
 * Animates a number from 0 to `target` with an ease-out curve.
 * Returns the target instantly under prefers-reduced-motion.
 */
export function useCountUp(target: number, duration = 0.9): number {
  const reduceMotion = useReducedMotion()
  const [value, setValue] = useState(() => (reduceMotion ? target : 0))

  useEffect(() => {
    if (reduceMotion) {
      setValue(target)
      return
    }
    const controls = animate(0, target, {
      duration,
      ease: "easeOut",
      onUpdate: v => setValue(Math.round(v)),
    })
    return () => controls.stop()
  }, [target, duration, reduceMotion])

  return value
}
