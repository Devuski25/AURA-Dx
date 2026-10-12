import type { ReactNode } from "react"
import { motion } from "framer-motion"
import { BreathWave } from "@/components/BreathWave"
import { Reveal } from "@/components/Reveal"
import { SplitHeading } from "@/components/SplitHeading"
import { useHeroParallax } from "@/lib/useHeroParallax"

type PageHeroProps = {
  title: string
  children: ReactNode
  /** Opt-in centred layout. Left-aligned by default, which suits text-led pages. */
  centered?: boolean
}

export function PageHero({ title, children, centered = false }: PageHeroProps) {
  const { ref, style } = useHeroParallax()
  return (
    <section ref={ref} className="relative overflow-hidden bg-gradient-to-br from-aura-hero-from via-aura-hero-via to-aura-hero-to px-6 pb-28 pt-20 md:pb-32 md:pt-24">
      <div aria-hidden="true" className="absolute inset-0 aura-dots opacity-20" />
      <motion.div
        style={style}
        className={centered ? "relative z-10 mx-auto max-w-4xl text-center" : "relative z-10 mx-auto max-w-6xl"}
      >
        <SplitHeading
          text={title}
          className={
            centered
              ? "mx-auto max-w-[20ch] text-center font-display text-[clamp(2.1rem,4.5vw,3.25rem)] font-bold leading-[1.08] tracking-tight text-white"
              : "max-w-[24ch] font-display text-[clamp(2.1rem,4.5vw,3.25rem)] font-bold leading-[1.08] tracking-tight text-white"
          }
        />
        <Reveal
          as="p"
          delay={0.55}
          className={
            centered
              ? "mx-auto mt-5 max-w-[58ch] text-center text-lg leading-relaxed text-white/75"
              : "mt-5 max-w-[60ch] text-lg leading-relaxed text-white/75"
          }
        >
          {children}
        </Reveal>
      </motion.div>
      <BreathWave className="absolute inset-x-0 bottom-0 h-16 w-full" />
    </section>
  )
}