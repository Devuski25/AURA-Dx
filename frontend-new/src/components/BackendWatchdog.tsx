import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { useAuth } from "@/hooks/useAuth"
import { useAdaptivePoll } from "@/hooks/useAdaptivePoll"
import { probe, type Availability } from "@/lib/service-status"

/**
 * Watches for the backend going away while someone is mid-session.
 *
 * The point is not to nag. A clinician who started a screening and finds the
 * backend gone should be told once, plainly, rather than watching three buttons
 * fail in a row with no explanation.
 *
 * Pauses when the tab is hidden: a backgrounded tab that has not run a check in
 * ten minutes should not announce itself as an outage on return.
 *
 * Mount once, inside the authenticated shell.
 */

export function BackendWatchdog() {
  const { user } = useAuth()
  const previous = useRef<Availability | null>(null)
  // Latched once the user has been told, so a flapping backend does not repeat
  // the same toast every 30 seconds.
  const announced = useRef(false)

  useEffect(() => {
    if (!user) {
      previous.current = null
      announced.current = false
    }
  }, [user])

  // Self-scheduling with backoff, and gated on a session existing. An outage is
  // the one situation where this matters most, and it is also the one where a
  // flat 30s interval spends the most traffic to learn the least.
  useAdaptivePoll(
    async (): Promise<Availability> => {
      const { availability } = await probe()
      const before = previous.current
      previous.current = availability

      // Only react to a transition away from healthy. "checking" never reaches
      // here because probe() resolves to a concrete state.
      if (availability === "offline" && before !== "offline" && !announced.current) {
        announced.current = true
        toast.error("Connection to the AURA-Dx service lost", {
          description:
            "Screening is unavailable until the connection recovers. Your work already saved is safe.",
          duration: 8000,
        })
      } else if (availability !== "offline" && before === "offline") {
        announced.current = false
        toast.success("Reconnected to the AURA-Dx service", { duration: 4000 })
      }
      return availability
    },
    { enabled: !!user },
  )

  return null
}