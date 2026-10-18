/**
 * Where the API lives, and why it is not always the same answer.
 *
 * Three environments, three different needs:
 *
 * 1. PRODUCTION — the bundle is served from auradx.xyz and the API is reached
 *    through the Cloudflare tunnel at api.auradx.xyz. `VITE_API_URL` is injected
 *    at build time from CI secrets, so this is just a string constant and the
 *    browser never has to think about it.
 *
 * 2. LOCAL DEV on the machine that also runs the backend — `localhost:8001`.
 *
 * 3. LOCAL DEV opened from another device on the same network — a phone at
 *    `http://192.168.1.42:5174`. This is the case that used to fail. The dev
 *    server was told to use `localhost:8001`, but on a phone `localhost` means
 *    the phone, so every request went to a port nobody was listening on and the
 *    app reported "inference down" while the Mini PC sat there perfectly
 *    healthy. The fix is to reuse the hostname the page was served from.
 *
 * The distinction is made on the *configured* value, not on the current
 * hostname: production must keep pointing at the tunnel even though it is also
 * reached over a network, and a developer running `localhost` deliberately
 * should not be silently redirected.
 */

import { supabase } from "./supabase"

/** Loopback hosts, where "localhost" would be a device-local address. */
const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?/i

const BACKEND_PORT = 8001

function resolveApiBase(): string {
  const configured = import.meta.env.VITE_API_URL

  // Production, or any explicitly non-loopback target: honour it verbatim.
  if (configured && !LOOPBACK.test(configured)) return configured

  // Loopback target. If the page itself is being served from somewhere other
  // than loopback — a phone or a second laptop on the LAN — the backend is on
  // that same host, so reuse its hostname and swap the port.
  if (typeof window !== "undefined" && window.location.hostname) {
    const { protocol, hostname } = window.location
    if (!LOOPBACK.test(`${protocol}//${hostname}`)) {
      return `${protocol}//${hostname}:${BACKEND_PORT}`
    }
  }

  // Genuinely local, or no browser at all (SSR, tests, build-time import).
  return configured ?? `http://localhost:${BACKEND_PORT}`
}

export const API_BASE = resolveApiBase()

export function getApiUrl(path: string): string {
  return `${API_BASE}${path}`
}

/**
 * Session expiry, handled once.
 *
 * Supabase access tokens last an hour. A tab left open between patients hits
 * that boundary, and every subsequent request comes back 401. What the user
 * saw was a stack of failed requests surfacing as "Analysis failed: Not
 * authenticated" and, once the error detail was passed through, a bare
 * "internal server error" -- neither of which says the fix is to sign in
 * again.
 *
 * AuthContext listens for this event and tears the session down, so the app
 * lands on the Login page with a reason rather than silently failing.
 */
export const SESSION_EXPIRED_EVENT = "aura:session-expired"

let sessionExpiryAnnounced = false

/** True when a response means "your token is no longer valid". */
export function isUnauthorized(res: Response): boolean {
  return res.status === 401
}

/**
 * Call on any 401. Announced at most once per page load -- a single expired
 * session produces a burst of 401s across every cached list, and navigating
 * five times to Login is worse than one.
 */
export function notifySessionExpired(): void {
  if (sessionExpiryAnnounced) return
  sessionExpiryAnnounced = true
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT))
}

/** Refresh this far ahead of the real expiry, so a request never races it. */
const REFRESH_MARGIN_SECONDS = 120

/**
 * The current access token, refreshed first if it is about to expire.
 *
 * Supabase access tokens live for one hour. Pages used to call `getSession()`
 * and send whatever came back, so once the hour passed every page in the
 * product started failing with "Invalid or expired token" -- a tab left open
 * between patients, or a phone that slept, was enough. The automatic refresher
 * in supabase-js is driven by a timer that browsers throttle hard in a
 * background tab, so it is routinely late by the time the user comes back.
 *
 * Checking `expires_at` before sending removes the race: the token handed to
 * fetch() has not expired, or was just renewed.
 */
export async function getFreshAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  const session = data.session
  if (!session?.access_token) return null

  const expiresAt = session.expires_at ?? 0
  const secondsLeft = expiresAt - Math.floor(Date.now() / 1000)
  if (secondsLeft > REFRESH_MARGIN_SECONDS) return session.access_token

  const { data: refreshed, error } = await supabase.auth.refreshSession()
  if (error || !refreshed.session?.access_token) return session.access_token
  return refreshed.session.access_token
}

/**
 * fetch() to the API with a valid bearer token, refreshing once on a 401.
 *
 * Every read in the product hand-rolled `getSession()` plus an Authorization
 * header, so a stale token surfaced as a raw backend message on the page --
 * "Unable to load screening result / Invalid or expired token" -- which reads
 * like the record is broken rather than like a clock ran out.
 *
 * So this retries before giving up: a 401 triggers one forced refresh and one
 * more attempt. Only if that also comes back 401 is the session really gone,
 * and only then is SESSION_EXPIRED_EVENT raised. A result left open overnight
 * loads again instead of demanding a new sign-in.
 */
export async function apiFetch(
  path: string,
  init: RequestInit = {},
  allowRetry = true
): Promise<Response> {
  const token = await getFreshAccessToken()
  if (!token) {
    notifySessionExpired()
    throw new Error("Not authenticated")
  }

  const headers = new Headers(init.headers)
  headers.set("Authorization", `Bearer ${token}`)

  const res = await fetch(getApiUrl(path), { ...init, headers })

  if (res.status === 401 && allowRetry) {
    // Force a refresh even if the token still looks live -- the server may have
    // rotated its signing key out from under us.
    const { data: refreshed } = await supabase.auth.refreshSession()
    const fresh = refreshed.session?.access_token
    if (fresh) {
      const retryHeaders = new Headers(init.headers)
      retryHeaders.set("Authorization", `Bearer ${fresh}`)
      const retried = await fetch(getApiUrl(path), { ...init, headers: retryHeaders })
      if (!isUnauthorized(retried)) return retried
      notifySessionExpired()
      return retried
    }
    notifySessionExpired()
  }

  return res
}
