import { useEffect, useState } from "react"
import { AlertTriangle, CheckCircle2, Loader2, WifiOff } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  AVAILABILITY_COPY,
  describeLastSeen,
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
 * Healthy state is a bare dot plus a short reassurance. Restating "Backend is
 * running" as a headline is noise: when it is obviously up, saying so adds
 * nothing, and when it is down the word "Backend" means nothing to a clinician.
 * Unavailable state keeps its explanation, because that is the case worth words.
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
      const { availability: next } = await probe()
      if (cancelled) return
      setAvailability(next)

      if (next !== "offline") {
        setDetail(null)
        return
      }
      // The probe failed. Ask Supabase when the backend last checked in.
      //
      // Always shown, fresh or stale, because the two cases point at different
      // faults and both are worth naming:
      //   fresh  -> the Mini PC is alive and talking to Supabase but unreachable
      //             from here, so the tunnel or the network is at fault
      //   stale  -> the Mini PC itself has been gone for a while
      const beat = await lastHeartbeat()
      if (cancelled) return
      setDetail(describeLastSeen(beat?.last_seen) || null)
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
  const healthy = availability === "online" || availability === "degraded"

  if (healthy) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn("flex items-center gap-2", className)}
      >
        {/* Text first, dot after. The dot is a trailing state marker rather
            than a leading bullet: this line ends a sentence about the service
            being ready, and a marker at the end reads as a full stop on it.
            Leading, it looked like a list item. */}
        <p
          className={cn(
            "text-xs font-medium",
            availability === "online" ? "text-aura-pine" : "text-amber-700"
          )}
        >
          {availability === "online" ? "Ready to screen." : AVAILABILITY_COPY.degraded.hint}
        </p>
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            availability === "online" ? "bg-emerald-500" : "bg-amber-500"
          )}
          aria-hidden="true"
        />
      </div>
    )
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-left",
        availability === "offline" ? "border-red-200 bg-red-50" : "border-aura-border-soft bg-aura-surface-alt",
        className
      )}
    >
      <span className="relative mt-1 flex h-2 w-2 shrink-0 items-center justify-center" aria-hidden="true">
        <span className={cn("absolute h-2 w-2 rounded-full", tone.dot)} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("flex items-center gap-1.5 text-sm font-semibold", tone.text)}>
          <Icon className={cn("h-3.5 w-3.5 shrink-0", availability === "checking" && "animate-spin")} aria-hidden="true" />
          {availability === "checking" ? "Checking services" : "Screening unavailable"}
        </p>
        <p className="mt-0.5 text-xs leading-snug text-aura-muted">
          {availability === "checking" ? "One moment." : AVAILABILITY_COPY.offline.hint}
          {detail && ` Last seen ${detail}.`}
        </p>
      </div>
    </div>
  )
}