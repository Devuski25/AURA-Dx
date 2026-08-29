import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  hint?: string
  action?: ReactNode
  className?: string
}

export function EmptyState({ icon: Icon, title, hint, action, className }: EmptyStateProps) {
  return (
    <div
      role="status"
      className={cn("flex flex-col items-center justify-center gap-3 px-6 py-12 text-center", className)}
    >
      <div aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-aura-sage">
        <Icon className="h-6 w-6 text-aura-muted" />
      </div>
      <div>
        <p className="text-sm font-semibold text-aura-ink">{title}</p>
        {hint ? <p className="mt-1 text-xs text-aura-muted">{hint}</p> : null}
      </div>
      {action ?? null}
    </div>
  )
}
