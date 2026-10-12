import type { ReactNode } from "react"
import { motion, useReducedMotion, type Variants } from "framer-motion"
import { EASE_OUT, VIEWPORT } from "@/lib/fine-motion"
import { cn } from "@/lib/utils"

const TAGS = { div: motion.div, li: motion.li, p: motion.p } as const
const GROUP_TAGS = { div: motion.div, ul: motion.ul, ol: motion.ol, dl: motion.dl } as const

/** Fade up out of a soft blur. Plain element when reduced motion is on. */
export function Reveal({
  children, className, delay = 0, y = 22, as = "div",
}: { children: ReactNode; className?: string; delay?: number; y?: number; as?: keyof typeof TAGS }) {
  const reduce = useReducedMotion()
  if (reduce) {
    const Plain = as as "div"
    return <Plain className={className}>{children}</Plain>
  }
  const Comp = TAGS[as] as typeof motion.div
  return (
    <Comp
      className={className}
      initial={{ opacity: 0, y, filter: "blur(5px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } }}
      viewport={VIEWPORT}
      transition={{ duration: 0.95, ease: EASE_OUT, delay }}
    >
      {children}
    </Comp>
  )
}

const container: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
}
const item: Variants = {
  hidden: { opacity: 0, y: 24, filter: "blur(4px)" },
  visible: { opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" }, transition: { duration: 0.9, ease: EASE_OUT } },
}

/** Parent that staggers its StaggerItem children in as it scrolls into view. */
export function Stagger({ children, className, as = "div" }: { children: ReactNode; className?: string; as?: keyof typeof GROUP_TAGS }) {
  const reduce = useReducedMotion()
  if (reduce) {
    const Plain = as as "div"
    return <Plain className={className}>{children}</Plain>
  }
  const Comp = GROUP_TAGS[as] as typeof motion.div
  return (
    <Comp className={className} variants={container} initial="hidden" whileInView="visible" viewport={{ ...VIEWPORT, amount: 0.15 }}>
      {children}
    </Comp>
  )
}

export function StaggerItem({ children, className, as = "div" }: { children: ReactNode; className?: string; as?: "div" | "li" }) {
  const reduce = useReducedMotion()
  if (reduce) {
    const Plain = as as "div"
    return <Plain className={className}>{children}</Plain>
  }
  const Comp = TAGS[as] as typeof motion.div
  return (
    <Comp className={className} variants={item}>
      {children}
    </Comp>
  )
}

/** A line that draws itself from the left. Give it a height and color via className. */
export function DrawRule({ className, delay = 0 }: { className?: string; delay?: number }) {
  const reduce = useReducedMotion()
  return (
    <motion.span
      aria-hidden="true"
      className={cn("block origin-left", className)}
      initial={reduce ? false : { scaleX: 0 }}
      whileInView={{ scaleX: 1 }}
      viewport={VIEWPORT}
      transition={{ duration: 1.2, ease: EASE_OUT, delay }}
    />
  )
}
