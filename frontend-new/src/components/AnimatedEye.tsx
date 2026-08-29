import { AnimatePresence, motion } from "framer-motion"
import { Eye, EyeOff } from "lucide-react"

/**
 * Eye/EyeOff swap with a rotate-scale flip for password visibility toggles.
 */
export function AnimatedEye({ visible }: { visible: boolean }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={visible ? "hide" : "show"}
        initial={{ rotate: -90, opacity: 0, scale: 0.6 }}
        animate={{ rotate: 0, opacity: 1, scale: 1 }}
        exit={{ rotate: 90, opacity: 0, scale: 0.6 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="inline-flex"
      >
        {visible ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
      </motion.span>
    </AnimatePresence>
  )
}
