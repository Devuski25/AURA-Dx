import { useEffect, useState } from "react"
import { AlertTriangle, CheckCircle2, Loader2, WifiOff } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  AVAILABILITY_COPY,
  describeLastSeen,
  isFresh,
  lastHeartbeat,
  probe,
  type Availability,
} from "@/lib/service-status"

const TONE: Record<Availability, { dot: string; text: string; icon: typeof CheckCircle2 }> = {
  checking: { dot: "bg-aura-muted", text: "text-aura-muted", icon: Loader2 },
  online: { dot: "bg-emerald-500", text: "text-aura-pine", icon: CheckCircle2 },
  degraded: { dot: "bg-amber-500", text: "text-amber-700", icon: AlertTriangle },
  offline: { dot: "bg-red-500", text: "text-red-700", icon: WifiOff },
}

/**
 * Login-page availability indicator.
 *
 * Answers the question a clinician walks in with: "can I use this right now?"
 * Deliberately plain. No error styling on the page itself, no blocking, no
 * spinner that never resolves -- if the backend is down the user still needs to
 * be able to read the form and sign in once it comes back.
 *
 * `role="status"` with aria-live so a screen reader announces a transition rather
 * than only the initial state.
 */
export function StatusIndicator({ className }: { className?: string }) {
  const [availability, setAvailability] = useState<Availability>("checking")
  const [detail, setDetail] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      const { availability: next, detail: payload } = await probe()
      if (cancelled) return
      setAvailability(next)

      if (next !== "offline") {
        setDetail(null)
        return
      }
      // The probe failed. Ask Supabase when the backend last checked in, so the
      // message can distinguish "off since 2 minutes ago" from "never started".
      const beat = await lastHeartbeat()
      if (cancelled) return
      setDetail(isFresh(beat?.last_seen) ? null : describeLastSeen(beat?.last_seen) || null)
    }

    void run()
    const id = setInterval(run, 30_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const tone = TONE[availability]
  const Icon = tone.icon
  const copy = availability === "checking" ? null : AVAILABILITY_COPY[availability]

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "mx-auto flex w-full max-w-sm items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-left",
        availability === "online" && "border-aura-border-soft bg-aura-surface-alt",
        availability === "degraded" && "border-amber-200 bg-amber-50",
        availability === "offline" && "border-red-200 bg-red-50",
        availability === "checking" && "border-aura-border-soft bg-aura-surface-alt",
        className
      )}
    >
      <span className="relative flex h-2.5 w-2.5 shrink-0 items-center justify-center" aria-hidden="true">
        <span className={cn("absolute h-2.5 w-2.5 rounded-full", tone.dot)} />
        {availability === "online" && (
          <span className={cn("absolute h-2.5 w-2.5 animate-ping rounded-full opacity-60", tone.dot)} />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <p className={cn("flex items-center gap-1.5 text-sm font-semibold", tone.text)}>
          <Icon
            className={cn(
              "h-3.5 w-3.5 shrink-0",
              availability === "checking" && "animate-spin"
            )}
            aria-hidden="true"
          />
          {copy ? copy.label : "Checking services"}
        </p>
        <p className="mt-0.5 text-xs leading-snug text-aura-muted">
          {copy ? copy.hint : "One moment."}
          {detail && ` Last seen ${detail}.`}
        </p>
      </div>
    </div>
  )
}