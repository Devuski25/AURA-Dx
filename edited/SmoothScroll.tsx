/* OPTIONAL. npm i lenis, then render <SmoothScroll /> once near the root (e.g. in your layout).
   Gives inertial, buttery wheel scrolling. It takes over native wheel scrolling, so remove it if
   you or your users find it disorienting. Skipped automatically when reduced motion is on. */
import { useEffect } from "react"
import Lenis from "lenis"
import { useReducedMotion } from "framer-motion"

export function SmoothScroll() {
  const reduce = useReducedMotion()
  useEffect(() => {
    if (reduce) return
    const lenis = new Lenis({ lerp: 0.09, smoothWheel: true })
    let id = requestAnimationFrame(function raf(time) {
      lenis.raf(time)
      id = requestAnimationFrame(raf)
    })
    return () => {
      cancelAnimationFrame(id)
      lenis.destroy()
    }
  }, [reduce])
  return null
}
