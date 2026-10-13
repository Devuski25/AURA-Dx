"use client"

import { Link } from "react-router-dom"
import { motion } from "framer-motion"
import { HelpCircle } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export function FloatingHelpButton() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.8, y: 20 }}
      transition={{ type: "spring", stiffness: 300, damping: 24 }}
      /* Hidden below lg: the bottom nav already carries a Help & Support item on
         exactly those viewports, so this button was a duplicate sitting on top of
         the nav bar (both fixed to the bottom-right) with a lower z-index. */
      className="fixed bottom-6 right-6 z-50 hidden lg:flex"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to="/help-support"
            className={cn(
              "flex items-center justify-center w-12 h-12 rounded-full bg-aura-forest text-white shadow-xl shadow-aura-forest/30",
              "transition-all duration-300 hover:shadow-2xl hover:shadow-aura-forest/40 hover:scale-105",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-forest focus-visible:ring-offset-2 focus-visible:ring-offset-aura-surface"
            )}
            aria-label="Help and Support"
          >
            <HelpCircle className="h-6 w-6" aria-hidden="true" />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="left">Help & Support</TooltipContent>
      </Tooltip>
    </motion.div>
  )
}