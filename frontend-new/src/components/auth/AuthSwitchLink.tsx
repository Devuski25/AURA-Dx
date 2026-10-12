import { Link } from "react-router-dom"
import type { LucideIcon } from "lucide-react"

type AuthSwitchLinkProps = {
  /** Leading mark — a person icon on Login, a sign-in icon on Register. */
  icon: LucideIcon
  /** e.g. "Don't have an account?" */
  prompt: string
  /** e.g. "Register an Account" */
  action: string
  /** Where the action navigates. */
  to: string
}

/**
 * The account-switch line that closes each auth form, below the Google button.
 * Login and Register pass inverted copy so the two read as the same component.
 */
export function AuthSwitchLink({ icon: Icon, prompt, action, to }: AuthSwitchLinkProps) {
  return (
    <div className="flex items-center justify-center gap-2">
      <Icon className="h-4 w-4 shrink-0 text-aura-muted" aria-hidden="true" />
      <p className="text-sm text-aura-muted">
        {prompt}{" "}
        <Link
          to={to}
          className="rounded-sm font-semibold text-aura-forest underline-offset-4 transition-colors duration-200 hover:text-aura-forest-light hover:underline focus-visible:outline-none focus-visible:underline"
        >
          {action}
        </Link>
      </p>
    </div>
  )
}