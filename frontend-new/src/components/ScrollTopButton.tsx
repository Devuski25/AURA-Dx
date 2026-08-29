"use client"

import { useEffect, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { ArrowUp } from "lucide-react"
import { Button } from "@/components/ui/button"

const SHOW_AFTER = 400

export function ScrollTopButton() {
  const [visible, setVisible] = useState(false)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > SHOW_AFTER)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  const scrollTop = () => {
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" })
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="scroll-top"
          initial={{ opacity: 0, y: 12, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.9 }}
          transition={{ type: "spring", stiffness: 320, damping: 24 }}
          className="fixed bottom-5 right-5 z-40 print:hidden sm:bottom-6 sm:right-6"
        >
          <Button
            onClick={scrollTop}
            size="icon"
            aria-label="Scroll back to top"
            title="Back to top"
            className="h-11 w-11 rounded-full border border-aura-border bg-aura-elevated text-aura-forest shadow-aura-lg transition-colors hover:bg-aura-surface-alt"
          >
            <ArrowUp className="h-5 w-5" aria-hidden="true" />
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
