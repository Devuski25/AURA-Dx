import { motion, useReducedMotion } from "framer-motion"
import { EASE_OUT } from "@/lib/fine-motion"

/** Words rise out of a mask, one after another. Screen readers get the plain sentence. */
export function SplitHeading({ text, className, delay = 0.15, as = "h1" }: { text: string; className?: string; delay?: number; as?: "h1" | "h2" }) {
  const reduce = useReducedMotion()
  const Tag = as
  if (reduce) return <Tag className={className}>{text}</Tag>
  const words = text.split(" ")
  return (
    <Tag className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {words.map((word, i) => (
          <span key={i}>
            <span className="inline-block overflow-hidden pb-[0.14em] align-bottom -mb-[0.14em]">
              <motion.span
                className="inline-block"
                initial={{ y: "115%", rotate: 4 }}
                animate={{ y: 0, rotate: 0 }}
                transition={{ duration: 1, ease: EASE_OUT, delay: delay + i * 0.07 }}
              >
                {word}
              </motion.span>
            </span>
            {i < words.length - 1 && " "}
          </span>
        ))}
      </span>
    </Tag>
  )
}
