import { useCallback, useEffect, useReducer, useRef, useState } from "react"
import { fetchWithCache, invalidate as invalidateKey, isStale, peekCache, subscribe } from "@/lib/cache"

type Options = {
  /** How long cached data is considered fresh. Default 30s. */
  ttlMs?: number
  /** How often a mounted view re-checks for newer data. Default 60s. */
  revalidateMs?: number
}

/** Default background re-check cadence for a view that stays open. */
const DEFAULT_REVALIDATE_MS = 60_000

/**
 * Stale-while-revalidate data hook backed by the module cache in lib/cache.
 *
 * - Instant render from cache (no skeleton flash on back-navigation)
 * - Background revalidation when stale
 * - Concurrent mounts share one request (deduped in cache layer)
 * - `isLoading` is true ONLY while there is no cached data to show
 * - `refresh()` bypasses TTL (used by manual refresh buttons / mutations)
 * - `invalidate(key)` from anywhere re-fetches every mounted view of that key,
 *   so a mutation on one screen is reflected on the others immediately
 * - A view left open revalidates on window focus and on a slow timer, so data
 *   changed by another user shows up without a manual reload
 *
 * Pass `key = null` to disable fetching entirely (e.g., while auth loads).
 */
export function useCachedData<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  options: Options = {},
) {
  const ttlMs = options.ttlMs ?? 30_000
  const revalidateMs = options.revalidateMs ?? DEFAULT_REVALIDATE_MS
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const [, bump] = useReducer((n: number) => n + 1, 0)
  const [error, setError] = useState<string | null>(null)

  const entry = key ? peekCache<T>(key) : null
  const hasData = entry !== null

  useEffect(() => {
    if (!key) return
    let cancelled = false

    const current = peekCache<T>(key)
    if (!current || isStale(current, ttlMs)) {
      fetchWithCache(key, () => fetcherRef.current())
        .then(() => {
          if (!cancelled) setError(null)
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "Failed to load")
          }
        })
        .finally(() => {
          if (!cancelled) bump()
        })
    }

    const unsubscribe = subscribe(key, bump)
    return () => {
      cancelled = true
      unsubscribe()
    }
    // `hasData` is a dependency on purpose: invalidate(key) clears the entry and
    // notifies subscribers, which re-renders with hasData=false, which re-runs
    // this effect and refetches. Without it an invalidated key would stay empty
    // until the component remounted. Re-running after data returns is harmless
    // because the fresh entry is no longer stale, and a successful fetch does not
    // change `hasData`, so this cannot loop.
  }, [key, ttlMs, hasData])

  // Keep an open view current: re-check when the tab regains focus and on a slow
  // timer. Only fetches when the entry is missing or past its TTL, so this stays
  // cheap while still surfacing changes made by other users or other tabs.
  useEffect(() => {
    if (!key) return
    let cancelled = false

    const revalidate = () => {
      /* A tab nobody is looking at has no reason to poll. The clinic runs on
       * shared machines and people leave screens open; without this, every
       * background tab keeps asking for the users list every ten seconds, and
       * twenty of them are indistinguishable from a burst. Coming back to the
       * tab fires `focus`, which revalidates immediately. */
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return
      const current = peekCache<T>(key)
      if (current && !isStale(current, ttlMs)) return
      fetchWithCache(key, () => fetcherRef.current())
        .then(() => {
          if (!cancelled) setError(null)
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "Failed to load")
          }
        })
        .finally(() => {
          if (!cancelled) bump()
        })
    }

    const onFocus = () => {
      if (typeof document === "undefined" || document.visibilityState === "visible") revalidate()
    }

    document.addEventListener("visibilitychange", onFocus)
    window.addEventListener("focus", onFocus)
    const timer = setInterval(revalidate, revalidateMs)

    return () => {
      cancelled = true
      document.removeEventListener("visibilitychange", onFocus)
      window.removeEventListener("focus", onFocus)
      clearInterval(timer)
    }
  }, [key, ttlMs, revalidateMs])

  /** Force a refetch (bypasses TTL). Resolves when fresh data is cached. */
  const refresh = useCallback(async (): Promise<void> => {
    if (!key) return
    try {
      await fetchWithCache(key, () => fetcherRef.current())
      setError(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load")
    } finally {
      bump()
    }
  }, [key])

  return {
    data: entry?.data ?? null,
    isLoading: !entry,
    error,
    refresh,
  }
}

/** Re-export so pages don't need to import from lib/cache directly. */
export { invalidateKey as invalidate }