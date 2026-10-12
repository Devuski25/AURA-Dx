import type { InputHTMLAttributes, ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import type { PasswordStrengthLevel } from "@/lib/password-strength"

/* Shared input chrome for the Login and Register forms, so the two read as one
   system instead of drifting apart.

   Every class below is a full literal string — nothing is interpolated — so
   Tailwind's scanner can see each one. `group` on the wrapper is what lets the
   leading icon recolour itself on focus via `group-focus-within`. */

const INPUT_BASE =
  "h-11 w-full rounded-lg border border-aura-border bg-white pl-11 text-sm text-aura-text shadow-aura-xs outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-aura-muted focus:border-aura-forest focus:ring-4 focus:ring-aura-forest/15 disabled:cursor-not-allowed disabled:opacity-60"

const INPUT_PLAIN = INPUT_BASE + " pr-4"
const INPUT_TRAILING = INPUT_BASE + " pr-12"

const LEADING_ICON =
  "pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-aura-muted transition-colors duration-200 group-focus-within:text-aura-forest"

/** Secondary action — Send code, Verify, Continue with Google. */
export const AUTH_SECONDARY_BUTTON =
  "flex h-11 items-center justify-center gap-2 rounded-lg border border-aura-border bg-white px-4 text-sm font-semibold text-aura-text shadow-aura-xs transition-colors duration-200 hover:bg-aura-sage focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-forest focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"

/* Label → input → footer sit 6px apart. `gap-1.5` rather than `gap-2` is what
   keeps an eight-field form from stacking up: across ten grid rows the 2px
   difference is 20px of card height, and the inputs' own height plus their
   border reads as enough separation on their own. */

type AuthFieldProps = {
  id: string
  label: string
  /** Leading icon. Recolours to aura-forest while the input has focus. */
  icon: LucideIcon
  /** Absolutely positioned inside the input box — pass `PasswordToggle`. */
  trailing?: ReactNode
  /** Sibling control to the right of the input, e.g. a "Send code" button. */
  aside?: ReactNode
  /** Rendered under the input row — password rules, mismatch warnings, meters. */
  footer?: ReactNode
  inputClassName?: string
} & Omit<InputHTMLAttributes<HTMLInputElement>, "className">

export function AuthField({
  id,
  label,
  icon: Icon,
  trailing,
  aside,
  footer,
  inputClassName,
  ...inputProps
}: AuthFieldProps) {
  const base = trailing ? INPUT_TRAILING : INPUT_PLAIN
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-aura-text">
        {label}
      </label>
      <div className="flex gap-2">
        <div className="group relative min-w-0 flex-1">
          <Icon aria-hidden="true" className={LEADING_ICON} />
          <input
            id={id}
            className={inputClassName ? base + " " + inputClassName : base}
            {...inputProps}
          />
          {trailing}
        </div>
        {aside}
      </div>
      {footer}
    </div>
  )
}

/* ─── Password strength ─────────────────────────────────────────────────── */

const METER_LABEL: Record<PasswordStrengthLevel, string> = {
  0: "Very weak",
  1: "Weak",
  2: "Fair",
  3: "Good",
  4: "Strong",
}

/* Only one variable at a time — the fill colour is data, not a class, so it
   stays out of the Tailwind pipeline entirely. */
const METER_FILL: Record<PasswordStrengthLevel, string> = {
  0: "var(--destructive)",
  1: "var(--destructive)",
  2: "var(--color-aura-warning)",
  3: "var(--color-aura-warning)",
  4: "var(--color-aura-accent)",
}

export function PasswordStrengthMeter({
  strength,
  className,
}: {
  strength: PasswordStrengthLevel
  /** Set a width when the meter sits in a flex row rather than a stacked block. */
  className?: string
}) {
  return (
    <div
      className={cn("space-y-1", className)}
      role="progressbar"
      aria-valuenow={strength}
      aria-valuemin={0}
      aria-valuemax={4}
      aria-label="Password strength"
    >
      <div className="h-1.5 overflow-hidden rounded-full bg-aura-border-soft">
        <div
          className="h-full transition-all duration-300"
          style={{ width: `${(strength / 4) * 100}%`, backgroundColor: METER_FILL[strength] }}
        />
      </div>
      <p className="text-xs text-aura-muted">{METER_LABEL[strength]}</p>
    </div>
  )
}