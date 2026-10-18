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
