import { cn } from "@/lib/utils"

type LogoSize = "sm" | "md" | "lg" | "xl"

const wordmarkSize: Record<LogoSize, string> = {
  sm: "text-base",
  md: "text-xl",
  lg: "text-2xl",
  /* Marketing heroes only — 28px against a 48px headline keeps the lockup
     clearly subordinate while still reading as a brand mark rather than a
     caption. */
  xl: "text-[1.75rem]",
}

const subtitleSize: Record<LogoSize, string> = {
  sm: "text-[0.6875rem]",
  md: "text-[0.75rem]",
  lg: "text-[0.8125rem]",
  /* Scales with the wordmark: at 8.8px the tagline became hard to read once
     the lockup was enlarged. */
  xl: "text-[0.9375rem]",
}

type LogoProps = {
  variant?: "full" | "mark"
  size?: LogoSize
  withSubtitle?: boolean
  className?: string
  inverse?: boolean
}

export function Logo({
  variant = "full",
  size = "md",
  withSubtitle = false,
  className,
  inverse = false,
}: LogoProps) {
  if (variant === "mark") {
    return (
      <span
        title="AURA-Dx"
        aria-label="AURA-Dx"
        className={cn(
          "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-aura-accent to-aura-accent-dark font-display text-sm font-bold tracking-tight text-white shadow-[0_4px_14px_rgba(42,154,99,0.35)]",
          className
        )}
      >
        Dx
      </span>
    )
  }

  return (
    <span
      title="AURA-Dx — Acoustic Unit for Respiratory Assessment"
      /* items-start keeps both the wordmark and the tagline pinned to the left
         edge of the lockup. Flex items default to align-self:stretch, which
         made the tagline box span the full rail and left its text looking
         stranded in the middle once it wrapped to a second line. */
      className={cn("flex min-w-0 flex-col items-start text-left", className)}
    >
      <span
        className={cn(
          "flex items-baseline justify-start font-display font-semibold tracking-widest",
          inverse ? "text-white" : "text-aura-text",
          wordmarkSize[size]
        )}
      >
        <span>AURA</span>
        <span aria-hidden="true" className={cn("mx-0.5", inverse ? "text-white/70" : "text-aura-muted")}>
          -
        </span>
        <span className={cn(
          "bg-gradient-to-r bg-clip-text text-transparent",
          inverse ? "from-[#7fd9b8] to-[#4c8b6e]" : "from-aura-accent to-aura-accent-dark"
        )}>
          Dx
        </span>
      </span>
      {withSubtitle && (
        <span
          className={cn(
            /* Wraps to two lines rather than truncating — the full expansion is
               the point of showing it, and the rail is sized to fit it. Tracking
               is tightened from 0.18em, which pushed the line past the rail.
               text-left keeps both wrapped lines flush with the wordmark. */
            "mt-1 text-left font-medium uppercase leading-tight tracking-[0.06em]",
            inverse ? "text-[#b9ccc3]" : "text-aura-muted",
            subtitleSize[size]
          )}
        >
          Acoustic Unit for Respiratory Assessment
        </span>
      )}
    </span>
  )
}