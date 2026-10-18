import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import {
  connectivity,
  describeLastSeen,
  lastHeartbeat,
  probe,
  type Availability,
  type ServiceStatus,
} from "@/lib/service-status"

/**
 * Login-page availability indicator.
 *
 * Answers the question a clinician walks in with: "can I use this right now?"
 * Deliberately plain. No error styling on the page itself, no blocking, no
 * spinner that never resolves -- if the backend is down the user still needs to
 * be able to read the form and sign in once it comes back.
 *
 * All three states render the same shape -- a short label, then a trailing dot,
 * in the same box -- so the indicator does not resize or reflow as it changes.
 * A box for "checking" that became bare text when healthy, then a wide bordered
 * box again when offline, meant the top-right corner moved three times in the
 * first second. The only thing that varies is the dot's colour.
 *
 * Word count follows urgency, not symmetry. Healthy gets five words because it
 * needs no attention. Down gets the shortest honest phrasing that still tells
 * the user something is wrong, plus when the backend was last seen when that is
 * known.
 *
 * `role="status"` with aria-live so a screen reader announces a transition rather
 * than only the initial state.
 */

const TONE: Record<Availability, { dot: string; text: string }> = {
  checking: { dot: "bg-aura-muted animate-pulse", text: "text-aura-muted" },
  online: { dot: "bg-emerald-500", text: "text-aura-pine" },
  degraded: { dot: "bg-amber-500", text: "text-amber-700" },
  offline: { dot: "bg-red-500", text: "text-red-700" },
}

export function StatusIndicator({ className }: { className?: string }) {
  const [availability, setAvailability] = useState<Availability>("checking")
  const [detail, setDetail] = useState<string | null>(null)
  const [status, setStatus] = useState<ServiceStatus | null>(null)

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      const { availability: next, detail: payload } = await probe()
      if (cancelled) return
      setAvailability(next)
      setStatus(payload)

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
  const link = connectivity(status)

  const label =
    availability === "checking"
      ? "Checking"
      : availability === "online"
        ? "Ready to screen."
        : availability === "degraded"
          ? "Limited"
          : "Offline"

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex flex-col items-end gap-1", className)}
    >
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium leading-none">
          <span className={cn("font-medium", tone.text)}>{label}</span>
          {/* Only the offline state carries a second line. Healthy and checking
              need nothing more than the dot. */}
          {availability === "offline" && detail && (
            <span className="ml-1.5 text-[0.6875rem] text-aura-muted">last seen {detail}</span>
          )}
        </span>
        <span
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", tone.dot)}
          aria-hidden="true"
        />
      </div>

      {/* Second line: the Mini PC's own connectivity.

          A genuinely different question from the line above. "Ready to screen"
          asks whether the backend answers, which it will over a LAN even with
          no internet at all. This asks whether Supabase is reachable, which is
          what Google sign-in and the verification email both depend on.

          Hidden while still checking, so the panel does not announce "offline"
          for the second before it has actually looked. */}
      {availability !== "checking" && (
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-[0.6875rem] font-medium leading-none",
              link.online ? "text-aura-muted" : "text-red-700"
            )}
          >
            {link.online
              ? link.label
              : "Mini PC offline · no internet"}
          </span>
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              link.online ? "bg-emerald-500" : "bg-red-500"
            )}
            aria-hidden="true"
          />
        </div>
      )}
    </div>
  )
}
