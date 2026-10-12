"use client"

import type { ReactNode } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { SignalWave } from "@/components/signature"

interface PageBannerProps {
  /** Chip row above the title — dates, roles, counts. Wraps on small screens. */
  eyebrow?: ReactNode
  title: string
  subtitle?: ReactNode
  /** Buttons or pills, right-aligned on desktop and wrapped below on mobile. */
  actions?: ReactNode
  /** Tighter padding and a smaller title, for pages below the fold. */
  compact?: boolean
  /**
   * Show the decorative waveform strip along the bottom edge. Defaults to true.
   * Set false where the dense table beneath leaves no clear band for it.
   */
  showWaveform?: boolean
}

/**
 * PageBanner — the dark green banner shared by Dashboard, Patient Records and
 * User Management.
 *
 * Extracted verbatim from the Dashboard so both render identically: same
 * gradient stops, ruled-field texture, waveform strip, chip styling and title
 * face. Every decorative layer is aria-hidden; the waveform is never given a
 * label because it encodes no data.
 *
 * The only motion is a short opacity fade. Under prefers-reduced-motion the
 * banner renders in its final state immediately.
 */
export function PageBanner({
  eyebrow,
  title,
  subtitle,
  actions,
  compact = false,
  showWaveform = true,
}: PageBannerProps) {
  const reduceMotion = useReducedMotion()

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className={
        compact
          ? "relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0a352e] via-aura-forest to-aura-forest-light px-4 py-6 sm:px-6 lg:px-8"
          : "relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0a352e] via-aura-forest to-aura-forest-light px-4 py-8 sm:px-6 lg:px-8"
      }
    >
      {/* Signature texture: a ruled field instead of dots, plus an optional
          low-contrast signal along the bottom edge. Both purely decorative. */}
      <div aria-hidden="true" className="aura-ecg-grid absolute inset-0 opacity-70" />
      {showWaveform ? (
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end overflow-hidden opacity-15">
          <SignalWave tone="mint" live={!reduceMotion} height={72} className="w-full" />
        </div>
      ) : null}

      <div className="relative z-10 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
        <div className="min-w-0">
          {eyebrow ? <div className="flex flex-wrap items-center gap-2">{eyebrow}</div> : null}
          <h1
            className={
              compact
                ? "mt-4 font-display text-2xl font-bold tracking-tight text-white md:text-3xl"
                : "mt-4 font-display text-3xl font-bold tracking-tight text-white md:text-4xl"
            }
          >
            {title}
          </h1>
          {subtitle ? <div className="mt-2 text-sm text-white/70">{subtitle}</div> : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">{actions}</div>
        ) : null}
      </div>
    </motion.div>
  )
}