import { getApiUrl } from "./api"

/**
 * Service availability.
 *
 * Two signals, deliberately separate:
 *
 *  - `probe()` asks the backend directly. Authoritative, but a failed request
 *    only proves the backend is unreachable -- not whether anyone switched it on.
 *  - `lastHeartbeat()` reads a row in Supabase, which stays reachable regardless
 *    of backend state. This is what lets the UI say "last seen 4 minutes ago",
 *    which is the difference between "ask the technician" and "nobody turned it
 *    on".
 *
 * Nothing here blocks login. The indicator is advisory: a clinician whose backend
 * is down still needs a clear message, not a spinner that never resolves.
 */

export type Availability = "checking" | "online" | "degraded" | "offline"

export interface ServiceStatus {
  backend: string
  database: string
  inference: string
  last_seen?: string | null
}

const PROBE_TIMEOUT_MS = 4000
const STALE_HEARTBEAT_MS = 3 * 60 * 1000

/** Status code -> availability. 0 means the request never completed. */
function toAvailability(status: ServiceStatus | null): Availability {
  if (!status) return "offline"
  if (status.backend !== "up") return "offline"
  if (status.database !== "up" || status.inference !== "up") return "degraded"
  return "online"
}

export async function probe(): Promise<{ availability: Availability; detail: ServiceStatus | null }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(getApiUrl("/api/status"), {
      signal: controller.signal,
      cache: "no-store",
    })
    if (!res.ok) return { availability: "offline", detail: null }
    const detail = (await res.json()) as ServiceStatus
    return { availability: toAvailability(detail), detail }
  } catch {
    // Timeout, DNS failure, tunnel 530, CORS. All mean the same thing to a user.
    return { availability: "offline", detail: null }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Read the heartbeat from Supabase. Used only when the probe fails, to add the
 * "was up 4 minutes ago" detail. Never throws.
 */
export async function lastHeartbeat(): Promise<ServiceStatus | null> {
  try {
    const { supabase } = await import("./supabase")
    const { data, error } = await supabase
      .from("service_status")
      .select("checked_at, backend, database, inference")
      .eq("id", true)
      .maybeSingle()
    if (error || !data) return null
    return {
      backend: data.backend,
      database: data.database,
      inference: data.inference,
      last_seen: data.checked_at,
    }
  } catch {
    return null
  }
}

/** Human phrasing for the heartbeat age. */
export function describeLastSeen(iso: string | null | undefined): string {
  if (!iso) return ""
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ""
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (seconds < 90) return "a moment ago"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`
  const hours = Math.round(minutes / 60)
  return `${hours} hour${hours === 1 ? "" : "s"} ago`
}

/** Is the heartbeat recent enough to still mean something? */
export function isFresh(iso: string | null | undefined): boolean {
  if (!iso) return false
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return false
  return Date.now() - then < STALE_HEARTBEAT_MS
}

export const AVAILABILITY_COPY: Record<Exclude<Availability, "checking">, { label: string; hint: string }> = {
  online: { label: "Backend is running", hint: "Ready to screen." },
  degraded: { label: "Backend is running", hint: "Some services are unavailable. Screening may be affected." },
  offline: { label: "Backend is offline", hint: "Screening is unavailable. Please contact your administrator." },
}