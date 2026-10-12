import { motion, useReducedMotion } from "framer-motion"
import { CountUp } from "@/components/CountUp"
import { EASE_OUT, VIEWPORT } from "@/lib/fine-motion"

/* An illustrative result: a 4 s clip as a spectrogram, the 2.0 s peak-centered window
   the classifier reads, and the per-class probabilities. Sample data only. */

const COLS = 60
const ROWS = 16
const CELL = 10

const noise = (c: number, r: number) => {
  const s = Math.sin(c * 12.9898 + r * 78.233) * 43758.5453
  return s - Math.floor(s)
}

const CELLS = (() => {
  const out: { x: number; y: number; o: number }[] = []
  for (let c = 0; c < COLS; c++) {
    const burst = Math.exp(-(((c - 30) / 9) ** 2)) * 0.9 + Math.exp(-(((c - 8) / 4) ** 2)) * 0.35 + 0.08
    for (let r = 0; r < ROWS; r++) {
      const falloff = Math.exp(-r / 6.5)
      const harmonic = 0.65 + 0.35 * Math.sin(r * 1.7 + c * 0.15)
      const v = Math.min(1, burst * falloff * harmonic * (0.7 + 0.3 * noise(c, r)))
      if (v > 0.04) out.push({ x: c * CELL, y: (ROWS - 1 - r) * CELL, o: Math.round(v * 100) / 100 })
    }
  }
  return out
})()

const CLASSES = [
  { name: "COPD", pct: 81, lead: true },
  { name: "Pneumonia", pct: 13, lead: false },
  { name: "Healthy", pct: 6, lead: false },
]

export function ResultSpecimen() {
  const reduce = useReducedMotion()
  return (
    <div className="grid gap-8 rounded-2xl border border-aura-border-soft bg-white p-6 md:grid-cols-[1.4fr_1fr] md:gap-12 md:p-8">
      <div>
        <h3 className="font-display text-base font-bold text-aura-text">What the classifier reads</h3>
        {/* Spectrogram sweeps in left to right, like a recording being read */}
        <motion.div
          className="mt-4"
          initial={reduce ? false : { clipPath: "inset(0 100% 0 0)" }}
          whileInView={{ clipPath: "inset(0 0% 0 0)" }}
          viewport={VIEWPORT}
          transition={{ duration: 1.8, ease: EASE_OUT }}
        >
          <svg
            role="img"
            aria-label="Example spectrogram of a four second breathing clip with the central two seconds highlighted"
            viewBox={`0 0 ${COLS * CELL} ${ROWS * CELL}`}
            preserveAspectRatio="none"
            className="block h-40 w-full rounded-lg bg-aura-sage/50"
          >
            {CELLS.map((cell) => (
              <rect key={`${cell.x}-${cell.y}`} x={cell.x} y={cell.y} width={CELL} height={CELL} fill="var(--color-aura-forest)" fillOpacity={cell.o} />
            ))}
          </svg>
        </motion.div>
        {/* The analysis window frames itself once the sweep has passed */}
        <motion.div
          className="relative -mt-40 ml-[25%] h-40 w-1/2 rounded-sm border-2 border-aura-accent"
          aria-hidden="true"
          initial={reduce ? false : { opacity: 0, scale: 1.06 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={VIEWPORT}
          transition={{ duration: 0.9, ease: EASE_OUT, delay: 1.5 }}
        />
        <div className="ml-[25%] mt-2 w-1/2 border-t-2 border-aura-accent pt-1.5 text-center text-xs text-aura-muted">2.0 s analysis window</div>
      </div>

      <div className="flex flex-col">
        <h3 className="font-display text-base font-bold text-aura-text">What the clinician sees</h3>
        <dl className="m-0 mt-4 flex flex-col gap-4">
          {CLASSES.map((c, i) => (
            <div key={c.name}>
              <div className="flex items-baseline justify-between text-sm">
                <dt className={c.lead ? "font-semibold text-aura-text" : "text-aura-muted"}>{c.name}</dt>
                <dd className={`m-0 tabular-nums ${c.lead ? "font-bold text-aura-text" : "text-aura-muted"}`}>
                  <CountUp to={c.pct} suffix="%" delay={0.4 + i * 0.15} duration={1.6} />
                </dd>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-aura-sage">
                <motion.div
                  className={`h-full rounded-full ${c.lead ? "bg-aura-forest" : "bg-aura-accent/50"}`}
                  initial={reduce ? false : { width: 0 }}
                  whileInView={{ width: `${c.pct}%` }}
                  viewport={VIEWPORT}
                  transition={{ duration: 1.6, ease: EASE_OUT, delay: 0.4 + i * 0.15 }}
                />
              </div>
            </div>
          ))}
        </dl>
        <motion.p
          className="mt-6 border-l-4 border-aura-accent pl-3 text-sm leading-relaxed text-aura-text"
          initial={reduce ? false : { opacity: 0, x: -12 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={VIEWPORT}
          transition={{ duration: 0.9, ease: EASE_OUT, delay: 1.3 }}
        >
          <strong className="font-semibold">Suggested next step:</strong> flag for clinician review.
        </motion.p>
        <p className="mt-auto pt-6 text-xs text-aura-muted">Illustrative example, not patient data.</p>
      </div>
    </div>
  )
}
