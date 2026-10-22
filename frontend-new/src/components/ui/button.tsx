import * as React from "react"
import * as SlotPrimitive from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-[color,background-color,border-color,transform,box-shadow] duration-150 ease-out will-change-transform active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      /* The hover states are split in two.

         `hover-tap:` is a COLOUR change -- the background or the text the
         button takes when the pointer is over it. A phone and a tablet
         have no pointer to hover with, and a tap latches the hover state
         so the button stays that colour after the finger has gone. So on
         those two the colour is simply the button's colour, and the
         desktop keeps the hover.

         `lg:hover:` is the rest -- the shadow, the lift. Those are mouse
         flourishes, and on a touch screen they latch, so they happen on
         the desktop breakpoint only.

         The `default`, `destructive` and `secondary` buttons hover to a
         slightly see-through version of their own colour, which is not a
         different colour at all. Baking that in would leave the main
         button looking washed out on every phone, so those keep their
         solid colour there and hover on the desktop. */
      variant: {
        default: "bg-primary text-primary-foreground lg:hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground lg:hover:bg-destructive/90",
        /* A destructive button that does NOT change on hover.

           The confirm dialog is the hard stop in front of a deletion, so the
           button that opens it does not have to shout. But some deletions
           are worth shouting about -- a patient's whole history, a screening
           result -- and this is the one they live on.

           It has no hover state at all, on any device: the red is the red
           whether the pointer is over it or not. A button that changes
           colour when you move towards it is a button you can mis-click. */
        "destructive-solid": "bg-destructive text-white",
        outline: "border border-transparent bg-background text-foreground hover-tap:bg-accent hover-tap:text-accent-foreground lg:border-input",
        secondary: "bg-secondary text-secondary-foreground lg:hover:bg-secondary/80",
        ghost: "hover-tap:bg-accent hover-tap:text-accent-foreground",
        link: "text-primary underline-offset-4 lg:hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-11 w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? SlotPrimitive.Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }