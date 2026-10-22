import { Component, type ErrorInfo, type ReactNode } from "react"
import { AlertTriangle, RotateCw } from "lucide-react"

type Props = {
  children: ReactNode
}

type State = {
  error: Error | null
}

/**
 * Catches render-time crashes and shows a recoverable screen.
 *
 * Without this, a throw during render unmounts the whole tree and leaves a blank
 * white page. On a phone that is indistinguishable from a crashed app, and the
 * only remedy is a manual browser reload -- which is a hard requirement on the
 * clinic's devices, not a small annoyance.
 *
 * This is a safety net, not a strategy. The stack is logged rather than shown:
 * an error message containing internals is an information leak, and the person
 * who needs to act on a crash is you, reading the console or the logs.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[AURA-Dx] Unhandled render error:", error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex min-h-screen items-center justify-center bg-aura-bg px-4">
        <div
          role="alert"
          className="w-full max-w-md rounded-2xl border border-aura-border bg-white p-8 text-center shadow-aura-xl"
        >
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50">
            <AlertTriangle className="h-6 w-6 text-amber-600" aria-hidden="true" />
          </div>
          <h1 className="font-display text-xl font-bold text-aura-ink">
            Something went wrong
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-aura-muted">
            The page could not be displayed. Reloading usually fixes it. If it keeps
            happening, note the time and tell your administrator.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-aura-forest px-4 text-sm font-semibold text-white transition-colors hover-tap:bg-aura-forest-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-forest focus-visible:ring-offset-2"
          >
            <RotateCw className="h-4 w-4" aria-hidden="true" />
            Reload
          </button>
        </div>
      </div>
    )
  }
}
