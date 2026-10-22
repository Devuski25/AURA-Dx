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
 *
 * The action sits on its own line below the prompt rather than trailing it.
 * Inline, the pair runs to roughly 40 characters and wraps mid-thought on a
 * narrow phone; stacked, each line is short and the link reads as the call to
 * action it is.
 */
export function AuthSwitchLink({ icon: Icon, prompt, action, to }: AuthSwitchLinkProps) {
  return (
    <div className="flex flex-col items-center gap-1.5 text-center">
      <span className="flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-aura-muted" aria-hidden="true" />
        <span className="text-sm text-aura-muted">{prompt}</span>
      </span>
      <Link
        to={to}
        className="rounded-sm text-sm font-semibold text-aura-forest underline-offset-4 transition-colors duration-200 hover-tap:text-aura-forest-light lg:hover:underline focus-visible:outline-none focus-visible:underline"
      >
        {action}
      </Link>
    </div>
  )
}