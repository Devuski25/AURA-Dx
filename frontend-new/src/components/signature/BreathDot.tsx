import { cn } from "@/lib/utils"

type BreathTone = "mint" | "coral" | "forest" | "sky"

const BREATH_TONE_CLASS: Record<BreathTone, string> = {
  mint: "bg-aura-mint",
  coral: "bg-aura-coral",
  forest: "bg-aura-forest",
  sky: "bg-sky-600",
}

/**
 * BreathDot — the app's single "this is live" indicator, built on the shared
 * `aura-breath` keyframe (4s, scale 1 → 1.04, opacity 0.7 → 1).
 *
 * Always decorative: it carries no meaning on its own, so it is aria-hidden
 * and never the only signal for a status. Under prefers-reduced-motion the
 * global block clamps the animation to a single frame, leaving a static dot.
 */
export function BreathDot({
  tone = "mint",
  size = 8,
  pulse = true,
  className,
}: {
  tone?: BreathTone
  /** Diameter in px. */
  size?: number
  pulse?: boolean
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block shrink-0 rounded-full",
        pulse && "aura-breath",
        BREATH_TONE_CLASS[tone],
        className,
      )}
      style={{ width: size, height: size }}
    />
  )
}