import { useEffect, useRef } from "react"
import { pollDelayMs, POLL_BASE_MS, POLL_MAX_MS, type Availability } from "@/lib/service-status"

/**
 * A poll that schedules its own next run, and backs off while unhealthy.
 *
 * Replaces `setInterval(run, 30_000)` in the three components that watch
 * service availability. Three reasons it is not an interval:
 *
 *  - **Backoff.** `setInterval` cannot change its own cadence. This one asks
 *    `pollDelayMs` after every result, so a backend that is down gets checked
 *    at 30s, 60s, 120s, 240s, then every 5 minutes, while a healthy one is
 *    never polled less often than every 30s. A flat interval against a dead
 *    Mini PC spends twice the traffic to learn nothing twice as fast.
 *
 *  - **No pile-up.** A slow check under `setInterval` overlaps the next one.
 *    Here the next run is only scheduled once the current one has resolved, so
 *    a hung request cannot stack.
 *
 *  - **Hidden tabs.** Nothing is scheduled while the tab is in the background,
 *    and returning to it checks immediately. A laptop left open on the Login
 *    page overnight should not have sent 2,880 requests overnight, and coming
 *    back should not report a state from an hour ago.
 *
 * `run` must resolve to an `Availability`. A rejected promise is treated as
 * "offline", because from the caller's point of view that is what happened, and
 * letting it escape would leave the poll unscheduled forever.
 */
export function useAdaptivePoll(
  run: () => Promise<Availability>,
  options: {
    /** Skip polling entirely without unmounting. */
    enabled?: boolean
    baseMs?: number
    maxMs?: number
  } = {},
) {
  const { enabled = true, baseMs = POLL_BASE_MS, maxMs = POLL_MAX_MS } = options

  // Held in a ref so an inline `run` closure does not restart the schedule on
  // every render. Re-running the effect would reset the backoff to 30s and
  // defeat it.
  const runRef = useRef(run)
  useEffect(() => {
    runRef.current = run
  }, [run])

  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    let timer: number | undefined
    let consecutiveFailures = 0

    // Both declared as function declarations so they can call each other --
    // `tick` needs `schedule` and `schedule` needs `tick`, which `const` arrows
    // cannot express without a temporal-dead-zone trap at first call.
    function schedule(delayMs: number) {
      if (cancelled) return
      timer = window.setTimeout(tick, delayMs)
    }

    async function tick() {
      if (cancelled) return

      if (document.hidden) {
        /* Do not schedule anything: the listener below starts the next check
           when the tab is visible again. A timer that wakes only to return is
           still a wake-up on a phone that is trying to sleep. */
        return
      }

      let availability: Availability
      try {
        availability = await runRef.current()
      } catch {
        availability = "offline"
      }
      if (cancelled) return

      // Only `online` counts as healthy. "degraded" is a real fault -- the
      // inference service is unreachable -- and backing off is right for it
      // too, since retrying hard will not restart a crashed process.
      consecutiveFailures = availability === "online" ? 0 : consecutiveFailures + 1
      /* The tab may have gone away while the request was in flight. */
      if (document.hidden) return
      schedule(pollDelayMs(consecutiveFailures, baseMs, maxMs))
    }

    function onVisibilityChange() {
      if (document.visibilityState !== "visible") return
      if (timer !== undefined) {
        window.clearTimeout(timer)
        timer = undefined
      }
      void tick()
    }

    void tick()
    document.addEventListener("visibilitychange", onVisibilityChange)

    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [enabled, baseMs, maxMs])
}