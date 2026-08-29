/**
 * Minimal module-level data cache with request de-duplication and
 * invalidation notifications. Zero dependencies.
 *
 * Guarantees:
 * - Concurrent mounts asking for the same key share ONE network request
 * - `invalidate(key)` drops the entry and notifies subscribers
 * - Entries are plain snapshots; callers decide freshness via TTL checks
 */

type Entry = { data: unknown; fetchedAt: number }

const store = new Map<string, Entry>()
const inflight = new Map<string, Promise<unknown>>()
const listeners = new Map<string, Set<() => void>>()

function notify(key: string): void {
  listeners.get(key)?.forEach((cb) => cb())
}

/** Returns the cached entry for a key, or null. */
export function peekCache<T>(key: string): { data: T; fetchedAt: number } | null {
  const entry = store.get(key)
  return entry ? { data: entry.data as T, fetchedAt: entry.fetchedAt } : null
}

/** True when the entry is older than ttlMs. */
export function isStale(entry: { fetchedAt: number }, ttlMs: number): boolean {
  return Date.now() - entry.fetchedAt > ttlMs
}

/**
 * Fetches via the given fetcher, de-duplicating concurrent calls for the
 * same key. On success, caches the result and notifies subscribers.
 * On failure, the error propagates to every caller of this key.
 */
export function fetchWithCache<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key)
  if (existing) return existing as Promise<T>

  const promise = (async () => {
    try {
      const data = await fetcher()
      store.set(key, { data, fetchedAt: Date.now() })
      notify(key)
      return data
    } finally {
      inflight.delete(key)
    }
  })()

  inflight.set(key, promise)
  // Swallow rejections on the stored reference so an unhandled-rejection
  // warning can't fire while callers attach their own handlers.
  promise.catch(() => undefined)
  return promise
}

/** Drops the cached entry (if any) and notifies subscribers. */
export function invalidate(key: string): void {
  store.delete(key)
  notify(key)
}

/** Subscribes to changes for a key. Returns an unsubscribe function. */
export function subscribe(key: string, cb: () => void): () => void {
  if (!listeners.has(key)) listeners.set(key, new Set())
  listeners.get(key)!.add(cb)
  return () => {
    listeners.get(key)?.delete(cb)
  }
}
