import { apiFetch } from "@/lib/api"

/**
 * The accounts list, and the cache key it lives under.
 *
 * Shared rather than written inline in Admin.tsx because two pages use it.
 * The Users page fetches it, and the Dashboard warms it: an admin lands on the
 * Dashboard, reads the overview, then opens Users -- and that first request is
 * the slowest thing either page does. On a cold connection it is two calls to
 * the hosted database (the profiles query, plus the auth service for the
 * confirmed-email set), about 1.7s before the network even gets involved.
 *
 * Fetching it while the admin is looking at something else moves that wait to
 * where nobody is watching it, which is the same reasoning as the backend's
 * startup warm-up in main.py.
 */
export const ADMIN_USERS_KEY = "admin-users"

export async function fetchAdminUsers(): Promise<any[]> {
  const res = await apiFetch("/api/users")
  if (!res.ok) throw new Error("Failed to fetch users")
  return res.json()
}
