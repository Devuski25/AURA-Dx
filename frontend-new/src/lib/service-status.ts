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
  /** wifi | wired | unknown. The *kind* of link, never the network name. */
  minipc_link?: string
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
 * Is the Mini PC actually on a network?
 *
 * Two independent questions, and the UI must not blur them:
 *
 *  - "Can the backend answer?" -- answered by `/api/status` at all.
 *  - "Can the Mini PC reach the internet?" -- answered by the Supabase probe
 *    succeeding. Google sign-in and the verification email both go through
 *    hosted services, so this is what decides whether a clinician can get in.
 *
 * `database: "up"` already proves connectivity, because reaching Supabase means
 * the internet works. `minipc_link` is only context -- Wi-Fi or a cable -- and
 * is never presented as a second liveness signal.
 *
 * A machine on Wi-Fi with the cable pulled still passes this test, which is the
 * intended behaviour: the clinic is expected to run a pocket wifi, and the
 * indicator should stay green on it.
 */
export type LinkKind = "wifi" | "wired" | "unknown"

export interface Connectivity {
  online: boolean
  link: LinkKind
  label: string
}

export function connectivity(status: ServiceStatus | null): Connectivity {
  const link = (status?.minipc_link ?? "unknown") as LinkKind
  // Reaching Supabase is the connectivity proof. The backend answering at all
  // over a LAN does not imply the internet works.
  const online = !!status && status.database === "up"
  const kind = link === "wifi" ? "Wi-Fi" : link === "wired" ? "Wired" : null
  return {
    online,
    link,
    label: kind ? `Mini PC online · ${kind}` : "Mini PC online",
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

/* An AVAILABILITY_COPY map used to live here, holding the wording for each
   state. StatusIndicator renders its own labels now -- deliberately shorter,
   and in one consistent shape so the indicator does not resize as it changes --
   so the map has no consumer. Left in place it would be the kind of thing that
   looks authoritative and quietly goes stale against the component that actually
   renders. Add state copy next to the component instead. */
