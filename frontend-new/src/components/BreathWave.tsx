import { motion, useReducedMotion } from "framer-motion"
import { EASE_OUT } from "@/lib/fine-motion"

const W = 1200
const H = 80
const MID = H / 2

const PATH = (() => {
  const pts: string[] = []
  for (let x = 0; x <= W; x += 3) {
    const t = x / W
    const envelope = 0.15 + 0.85 * Math.sin(t * Math.PI * 3.5) ** 2
    const y = MID + envelope * (Math.sin(x * 0.11) * 24 + Math.sin(x * 0.37 + 1) * 8 + Math.sin(x * 0.83) * 3)
    pts.push(`${x === 0 ? "M" : "L"}${x},${y.toFixed(1)}`)
  }
  return pts.join(" ")
})()

const FADE_EDGES = "linear-gradient(to right, transparent, #000 14%, #000 86%, transparent)"

function Wave({ stroke, width }: { stroke: string; width: number }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" fill="none" className="block h-full w-full">
      <path d={PATH} stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/**
 * Decorative. The line draws left to right once, then a soft highlight travels along it on a loop
 * (see .aura-wave-sweep in theme-additions.css). Pass a positioned className, e.g. "absolute inset-x-0 bottom-0 h-24".
 * Static when reduced motion is on.
 */
export function BreathWave({ className }: { className?: string }) {
  const reduce = useReducedMotion()
  return (
    <div aria-hidden="true" className={className} style={{ maskImage: FADE_EDGES, WebkitMaskImage: FADE_EDGES }}>
      <motion.div
        className="h-full w-full"
        initial={reduce ? false : { clipPath: "inset(0 100% 0 0)" }}
        animate={{ clipPath: "inset(0 0% 0 0)" }}
        transition={{ duration: 2.6, ease: EASE_OUT, delay: 0.3 }}
      >
        <Wave stroke="var(--color-aura-accent)" width={1.5} />
      </motion.div>
      {!reduce && (
        <div className="aura-wave-sweep absolute inset-0">
          <Wave stroke="#fff" width={2.5} />
        </div>
      )}
    </div>
  )
}
