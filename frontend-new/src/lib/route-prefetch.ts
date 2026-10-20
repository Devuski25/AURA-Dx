/**
 * Fetching a page's code before the page is needed.
 *
 * Every page inside the app is a separate chunk, loaded when the route is
 * opened. The clinician clicks "View details" and the browser has to fetch
 * that chunk before anything can render -- a spinner, on a connection that
 * might be clinic wifi or a phone on mobile data.
 *
 * The chunks are small and the page is usually the next thing that gets
 * opened, so they are fetched while the browser is idle. The click then finds
 * the chunk in the HTTP cache and the page appears without a round trip.
 *
 * Only the code is prefetched, never the records. A prefetch that also
 * fetched a patient's data would put it in the cache for a page that might
 * never be opened, which is not the kind of thing to do with medical data.
 */

type RouteName =
  | "dashboard"
  | "screening"
  | "records"
  | "patient"
  | "screening-detail"
  | "admin"

const loaders: Record<RouteName, () => Promise<unknown>> = {
  dashboard: () => import("@/pages/Dashboard"),
  screening: () => import("@/pages/Screening"),
  records: () => import("@/pages/PatientRecords"),
  patient: () => import("@/pages/PatientDetail"),
  "screening-detail": () => import("@/pages/ScreeningDetail"),
  admin: () => import("@/pages/Admin"),
}

const alreadyRequested = new Set<RouteName>()

/** Load a route's code now, if it has not been asked for already. */
export function prefetchRoute(name: RouteName): void {
  if (alreadyRequested.has(name)) return
  alreadyRequested.add(name)
  const load = loaders[name]
  if (!load) return
  // A failed prefetch is not an error worth surfacing: the route will load
  // normally when it is actually opened, and the browser retries a chunk
  // that failed to arrive.
  load().catch(() => {
    alreadyRequested.delete(name)
  })
}

/**
 * The route a path points at.
 *
 * The order matters: the detail routes are matched first, because
 * "/dashboard/screenings/123" also starts with "/dashboard/screenings".
 */
export function routeForPath(pathname: string): RouteName | null {
  const p = pathname.replace(/\/+$/, "") || "/"
  if (p.startsWith("/dashboard/patients/")) return "patient"
  if (p.startsWith("/dashboard/screenings/")) return "screening-detail"
  if (p === "/dashboard/screenings" || p === "/dashboard/patient-records") return "records"
  if (p === "/dashboard/screening") return "screening"
  if (p === "/dashboard/admin") return "admin"
  if (p === "/dashboard") return "dashboard"
  return null
}

/**
 * What the user is most likely to open next, from where they are now.
 *
 * Prefetching every route on every idle period would be wasteful -- the
 * admin page is a quarter of the app's code and most clinicians never open
 * it. This is the one or two pages that follow from the current one.
 */
export function likelyNextRoutes(pathname: string): RouteName[] {
  const p = pathname.replace(/\/+$/, "") || "/"
  if (p === "/dashboard") return ["records", "screening"]
  if (p === "/dashboard/screenings" || p === "/dashboard/patient-records") {
    return ["patient", "screening-detail"]
  }
  if (p.startsWith("/dashboard/patients/") || p.startsWith("/dashboard/screenings/")) {
    return ["records"]
  }
  return []
}

/**
 * Prefetch when the browser is idle.
 *
 * `requestIdleCallback` is the right signal: it fires when the main thread
 * has nothing better to do, so the chunk download does not compete with
 * rendering what the user is already looking at. It is not available
 * everywhere, so there is a timeout fallback.
 */
export function whenIdle(fn: () => void, timeoutMs = 2000): void {
  if (typeof window === "undefined") return
  const idle = (window as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void
    cancelIdleCallback?: (id: number) => void
  }).requestIdleCallback
  if (typeof idle === "function") {
    idle(fn, { timeout: timeoutMs })
  } else {
    window.setTimeout(fn, 400)
  }
}
