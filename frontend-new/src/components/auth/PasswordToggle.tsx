import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { Eye, EyeOff } from "lucide-react"

type PasswordToggleProps = {
  /** True while the password is revealed. Drives both `aria-pressed` and the icon. */
  visible: boolean
  onToggle: () => void
}

/**
 * Eye / eye-off crossfade. `mode="wait"` lets the outgoing icon finish before
 * the incoming one arrives, so the two never overlap mid-rotation.
 *
 * Under reduced motion the swap is a plain opacity fade — no scale, no spin.
 */
export function PasswordToggle({ visible, onToggle }: PasswordToggleProps) {
  const reduced = useReducedMotion() ?? false

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={visible}
      aria-label={visible ? "Hide password" : "Show password"}
      className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-lg text-aura-muted transition-colors duration-200 hover-tap:text-aura-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-forest focus-visible:ring-offset-2"
    >
      <AnimatePresence initial={false} mode="wait">
        <motion.span
          key={visible ? "eye-off" : "eye"}
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.55, rotate: -30 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, rotate: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.55, rotate: 30 }}
          transition={{ duration: reduced ? 0.12 : 0.18, ease: "easeOut" }}
          className="flex items-center justify-center"
        >
          {visible ? <Eye className="h-[18px] w-[18px]" /> : <EyeOff className="h-[18px] w-[18px]" />}
        </motion.span>
      </AnimatePresence>
    </button>
  )
}