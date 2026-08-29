"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface ProgressProps
  extends React.HTMLAttributes<HTMLDivElement> {
  value: number
  max?: number
  indicatorClassName?: string
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value, max = 100, indicatorClassName, ...props }, ref) => {
    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        className={cn(
          "relative h-2 w-full overflow-hidden rounded-full bg-secondary",
          className
        )}
        {...props}
      >
        <div
          className={cn(
            "h-full bg-primary transition-all duration-300 ease-out",
            indicatorClassName
          )}
          style={{
            width: `${Math.min(Math.max(value, 0), max) / max * 100}%`,
          }}
        />
      </div>
    )
  }
)
Progress.displayName = "Progress"

export { Progress }