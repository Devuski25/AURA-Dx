import { useCallback, useEffect, useReducer, useRef, useState } from "react"
import { fetchWithCache, invalidate as invalidateKey, isStale, peekCache, subscribe } from "@/lib/cache"

type Options = {
  /** How long cached data is considered fresh. Default 30s. */
  ttlMs?: number
}

/**
 * Stale-while-revalidate data hook backed by the module cache in lib/cache.
 *
 * - Instant render from cache (no skeleton flash on back-navigation)
 * - Background revalidation when stale
 * - Concurrent mounts share one request (deduped in cache layer)
 * - `isLoading` is true ONLY while there is no cached data to show
 * - `refresh()` bypasses TTL (used by manual refresh buttons / mutations)
 *
 * Pass `key = null` to disable fetching entirely (e.g., while auth loads).
 */
export function useCachedData<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  options: Options = {},
) {
  const ttlMs = options.ttlMs ?? 30_000
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const [, bump] = useReducer((n: number) => n + 1, 0)
  const [error, setError] = useState<string | null>(null)

  const entry = key ? peekCache<T>(key) : null

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
  }, [key, ttlMs])

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
