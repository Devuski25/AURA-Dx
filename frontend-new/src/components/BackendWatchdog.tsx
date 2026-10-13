import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { useAuth } from "@/hooks/useAuth"
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
const CHECK_INTERVAL_MS = 30_000

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
      return
    }

    const run = async () => {
      if (document.visibilityState === "hidden") return

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
    }

    void run()
    const id = setInterval(run, CHECK_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === "visible") void run()
    }
    document.addEventListener("visibilitychange", onVisible)

    return () => {
      clearInterval(id)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [user])

  return null
}