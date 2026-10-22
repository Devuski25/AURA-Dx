import { useEffect, useRef, useState } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { cn } from "@/lib/utils"

/** Shared stroke colors per tone. Mirrors the aura-* tokens, no new hues. */
const TONE_CLASS: Record<SignalTone, string> = {
  forest: "text-aura-forest",
  mint: "text-aura-mint",
  coral: "text-aura-coral-strong",
}

export type SignalTone = "forest" | "mint" | "coral"

interface SignalWaveProps {
  /** Real amplitude samples. Omit for the idle sine-like drift. */
  peaks?: number[]
  /** Animate the idle drift. Ignored when `peaks` is supplied. */
  live?: boolean
  /** 0–1 input level; modulates the idle drift when live. */
  level?: number
  tone?: SignalTone
  /** Visual height in px. */
  height?: number
  /**
   * True only when the bars encode real measurement. Decorative uses are
   * aria-hidden so a waveform is never announced as clinical data.
   */
  labelled?: boolean
  label?: string
  className?: string
}

const BAR_COUNT = 56

/**
 * SignalWave — the acoustic motif for the app.
 *
 * Three modes:
 *  - `peaks` given: renders the real samples, static. Data, not decoration.
 *  - `live` (or default): a slow idle drift. Decorative.
 *  - `level` + `live`: the drift's amplitude tracks the input level.
 *
 * The idle drift is a single transform on one wrapper element rather than
 * per-bar animation, so it stays on the compositor and costs one animated
 * node per viewport. Off-screen it stops entirely via IntersectionObserver.
 */
export function SignalWave({
  peaks,
  live = false,
  level = 0,
  tone = "forest",
  height = 40,
  labelled = false,
  label = "Audio waveform",
  className,
}: SignalWaveProps) {
  const reduceMotion = useReducedMotion()
  const wrapRef = useRef<HTMLDivElement>(null)
  const [onScreen, setOnScreen] = useState(true)
  const isIdle = !peaks || peaks.length === 0

  // Pause the loop when scrolled out of view.
  useEffect(() => {
    const node = wrapRef.current
    if (!node || typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver(
      entries => setOnScreen(entries[0]?.isIntersecting ?? true),
      { rootMargin: "120px" },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const animated = !reduceMotion && onScreen && (isIdle ? live || !peaks : live)

  const bars = isIdle
    ? null
    : peaks!.slice(0, BAR_COUNT)

  if (bars) {
    // Real data: static, readable, and announced when the caller opts in.
    const max = Math.max(...bars, 1)
    return (
      <div
        ref={wrapRef}
        role={labelled ? "img" : undefined}
        aria-label={labelled ? label : undefined}
        aria-hidden={labelled ? undefined : true}
        className={cn("flex items-center justify-center gap-[2px]", TONE_CLASS[tone], className)}
        style={{ height }}
      >
        {bars.map((value, i) => (
          <span
            key={i}
            className="w-[2px] shrink-0 rounded-full bg-current"
            style={{ height: `${Math.max((value / max) * 100, 4)}%` }}
          />
        ))}
      </div>
    )
  }

  // Idle / live drift. One animated wrapper, bars are purely static shapes.
  const levelScale = 0.55 + Math.min(Math.max(level, 0), 1) * 0.85

  return (
    <motion.div
      ref={wrapRef}
      aria-hidden="true"
      className={cn("flex items-center justify-center gap-[3px] overflow-hidden", TONE_CLASS[tone], className)}
      style={{ height }}
      animate={
        animated
          ? { scaleY: [levelScale * 0.86, levelScale, levelScale * 0.86], opacity: [0.55, 0.9, 0.55] }
          : { scaleY: levelScale * 0.9, opacity: 0.6 }
      }
      transition={
        reduceMotion ? { duration: 0 } : { duration: 3.4, ease: "easeInOut", repeat: Infinity }
      }
    >
      {Array.from({ length: BAR_COUNT }).map((_, i) => {
        // A quiet deterministic profile: two low harmonics plus a breath
        // envelope, so it reads as a signal rather than random jitter.
        const t = i / BAR_COUNT
        const envelope = Math.sin(t * Math.PI)
        const harmonic =
          Math.sin(t * Math.PI * 6) * 0.34 + Math.sin(t * Math.PI * 17) * 0.16
        const h = 14 + Math.abs(harmonic) * 74 * (0.45 + envelope * 0.55)
        return (
          <span
            key={i}
            className="w-[2px] shrink-0 rounded-full bg-current"
            style={{ height: `${h}%`, opacity: 0.35 + envelope * 0.5 }}
          />
        )
      })}
    </motion.div>
  )
}