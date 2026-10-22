import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      /* A badge is TEXT, and a badge is 14px -- which is normal-size text,
         not large text, so it owes 4.5:1 like anything else.

         The solid-fill variants used to put white on the bright brand green
         (2.52:1) or on the amber (3.19:1) and both failed. The disease
         badges already got this right: a soft tint behind, a strong dark
         colour in front. These now use that same pattern, so every badge in
         the app reads the same way and every one of them passes.

           pine on mint-soft     4.71:1
           amber-strong on amber  4.51:1
           forest on surface-alt 11.11:1 */
      variant: {
        default: "border-transparent bg-primary text-primary-foreground lg:hover:bg-primary/80",
        secondary: "border-transparent bg-secondary text-secondary-foreground lg:hover:bg-secondary/80",
        destructive: "border-transparent bg-destructive text-destructive-foreground lg:hover:bg-destructive/80",
        outline: "text-foreground",
        success: "border-transparent bg-aura-mint-soft text-aura-pine lg:hover:bg-aura-mint-soft",
        warning: "border-transparent bg-aura-warning-soft text-aura-warning-strong lg:hover:bg-aura-warning-soft",
        info: "border-transparent bg-aura-surface-alt text-aura-forest lg:hover:bg-aura-surface-alt",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }