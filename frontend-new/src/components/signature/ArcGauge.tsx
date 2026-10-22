import { motion, useReducedMotion } from "framer-motion"
import { useCountUp } from "@/hooks/useCountUp"
import { cn } from "@/lib/utils"

/* 180° spirometer-style arc: a half-circle path sweeping from 180° to 0°. */
const ARC_WIDTH = 132
const ARC_HEIGHT = 78
const RADIUS = 54
const CENTER_X = ARC_WIDTH / 2
const CENTER_Y = ARC_HEIGHT - 12

/** Endpoints of the 180° sweep, left to right. */
const START = { x: CENTER_X - RADIUS, y: CENTER_Y }
const END = { x: CENTER_X + RADIUS, y: CENTER_Y }

/** Arc length, used to drive the progress dash offset. */
function arcLength(radius: number): number {
  return Math.PI * radius
}

interface ArcGaugeProps {
  /** 0—1 fraction. */
  value: number
  /** Drives the coral tone and the word below the arc. */
  flagged: boolean
  label: string
  className?: string
}

/**
 * ArcGauge — the instrument-panel replacement for the old ConfidenceRing.
 *
 * Reads as a spirometer dial: fixed mono ticks at 0/25/50/75/100, a rounded
 * progress stroke driven by the existing spring, and the count-up numeral
 * below the arc where a 0—100 confidence has room to breathe.
 *
 * `value` is data, so the figure carries an accessible label; colour is only
 * ever a secondary cue alongside the word and the numeral.
 */
export function ArcGauge({ value, flagged, label, className }: ArcGaugeProps) {
  const reduceMotion = useReducedMotion()
  const pct = Math.min(Math.max(value * 100, 0), 100)
  const shown = useCountUp(Math.round(pct))
  const trackLength = arcLength(RADIUS)
  const dash = trackLength * (pct / 100)

  const ticks = [0, 25, 50, 75, 100]

  return (
    <div className={cn("flex flex-col items-center", className)}>
      <div
        role="img"
        aria-label={`${label} ${pct.toFixed(0)} percent`}
        className="relative"
        style={{ width: ARC_WIDTH, height: ARC_HEIGHT }}
      >
        <svg
          width={ARC_WIDTH}
          height={ARC_HEIGHT}
          viewBox={`0 0 ${ARC_WIDTH} ${ARC_HEIGHT}`}
          className="text-aura-border-soft"
          aria-hidden="true"
        >
          {/* Track */}
          <path
            d={`M ${START.x} ${START.y} A ${RADIUS} ${RADIUS} 0 0 1 ${END.x} ${END.y}`}
            stroke="currentColor"
            strokeWidth="10"
            strokeLinecap="round"
            fill="none"
          />
          {/* Progress */}
          <motion.path
            d={`M ${START.x} ${START.y} A ${RADIUS} ${RADIUS} 0 0 1 ${END.x} ${END.y}`}
            stroke={flagged ? "var(--color-aura-coral)" : "var(--color-aura-mint)"}
            strokeWidth="10"
            strokeLinecap="round"
            fill="none"
            strokeDasharray={trackLength}
            initial={{ strokeDashoffset: trackLength }}
            animate={{ strokeDashoffset: trackLength - dash }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : { type: "spring", stiffness: 60, damping: 20 }
            }
          />
          {/* Ticks: short radial marks, labels carried in mono below. */}
          {ticks.map(tick => {
            const angle = Math.PI - (tick / 100) * Math.PI
            const inner = RADIUS - 15
            const outer = RADIUS - 10
            return (
              <line
                key={tick}
                x1={CENTER_X + Math.cos(angle) * inner}
                y1={CENTER_Y - Math.sin(angle) * inner}
                x2={CENTER_X + Math.cos(angle) * outer}
                y2={CENTER_Y - Math.sin(angle) * outer}
                stroke="currentColor"
                strokeWidth="1.5"
                className="text-aura-muted"
              />
            )
          })}
        </svg>

        {/* Numeral sits below the arc, not inside it. */}
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">
          <span
            className={cn(
              "font-display text-[30px] font-bold leading-none tabular-nums",
              flagged ? "text-aura-coral-strong" : "text-aura-pine",
            )}
          >
            {shown}%
          </span>
        </div>
      </div>

      <div className="mt-3 flex w-full items-center justify-between px-1 font-mono text-xs tabular-nums text-aura-muted">
        {ticks.map(tick => (
          <span key={tick}>{tick}</span>
        ))}
      </div>

      <p className="mt-2 text-center font-mono text-xs uppercase tracking-[0.08em] text-aura-muted">
        {label}
      </p>
    </div>
  )
}