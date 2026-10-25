"use client"

/**
 * Watching an analysis finish, wherever the clinician happens to be.
 *
 * A screening is written the moment the recordings are submitted, with the
 * status 'analysing', and the inference runs afterwards as a background job on
 * the Mini PC. That means the clinician is no longer stuck on a spinner for
 * two and a half minutes with a request hanging open -- they can record,
 * submit and walk away to another patient, and the result lands on its own.
 *
 * But a result nobody is told about is a result nobody acts on. This is the
 * thing that tells them.
 *
 * It lives above the router rather than inside the screening page, because the
 * point is to reach a clinician who has LEFT the screening page. A watcher
 * mounted on that page unmounts with it, which is exactly the case that needs
 * watching.
 *
 * The in-flight ids are kept in sessionStorage as well as in memory, so a
 * browser refresh mid-analysis does not lose track of a screening that is
 * still running.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { apiFetch } from "@/lib/api"

export interface AnalysisScreening {
  id: string
  status: string
  patient_name?: string | null
  respiratory_result?: string | null
  respiratory_confidence?: number | null
  respiratory_probabilities?: Record<string, number> | null
  cascade_path?: string | null
  model_version?: string | null
  created_at?: string | null
  /** When the analysis landed. Used to age the entry out. */
  finishedAt?: number
}

/** A screening whose analysis is still running. */
export interface PendingAnalysis {
  id: string
  patientName: string
  startedAt: number
}

interface WatcherValue {
  /** Start watching a screening. Safe to call twice for the same id. */
  track: (id: string, patientName: string) => void
  /** Stop watching. Called automatically when the analysis finishes. */
  untrack: (id: string) => void
  /** True while at least one analysis is running. */
  isAnalysing: boolean
  /** How many analyses are running. */
  pendingCount: number
  /** Analyses that have finished, by screening id. The full row. */
  finished: Record<string, AnalysisScreening>
}

const AnalysisWatcherContext = createContext<WatcherValue | null>(null)

const STORAGE_KEY = "aura-dx:pending-analyses"

/** How often to ask the server whether a screening has landed. */
const POLL_MS = 2500

/**
 * A finished analysis is kept in memory for this long so a page that mounts
 * after the fact can still pick it up. Long enough for the toast to be useful,
 * short enough that the map does not grow.
 */
const FINISHED_TTL_MS = 10 * 60 * 1000

function readStored(): PendingAnalysis[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function AnalysisWatcherProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [pending, setPending] = useState<PendingAnalysis[]>(() => readStored())
  const [finished, setFinished] = useState<Record<string, AnalysisScreening>>({})
  const inFlight = useRef(new Set<string>())
  const notified = useRef(new Set<string>())

  // Keep the in-flight set in step with state so the poll does not re-request
  // an id that has just finished.
  useEffect(() => {
    inFlight.current = new Set(pending.map((p) => p.id))
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pending))
    } catch {
      /* storage unavailable; in-memory tracking still works */
    }
  }, [pending])

  const untrack = useCallback((id: string) => {
    setPending((prev) => prev.filter((p) => p.id !== id))
  }, [])

  const track = useCallback((id: string, patientName: string) => {
    setPending((prev) => {
      if (prev.some((p) => p.id === id)) return prev
      return [...prev, { id, patientName, startedAt: Date.now() }]
    })
  }, [])

  /* The poll.

     One interval for every tracked screening, rather than one per screening:
     several analyses can be running at once, and an interval each would mean a
     timer per patient. The request is small -- one row -- and the server
     answers it from the database.
  */
  useEffect(() => {
    if (pending.length === 0) return

    let cancelled = false

    const runCheck = async () => {
      for (const p of pending) {
        if (cancelled) return
        if (notified.current.has(p.id)) continue
        try {
          const res = await apiFetch(`/api/screenings/${p.id}`)
          if (cancelled) return
          if (!res.ok) {
            // A screening that cannot be read is not one to keep polling --
            // it was deleted, or the caller lost access to it.
            if (res.status === 404 || res.status === 403) {
              notified.current.add(p.id)
              setPending((prev) => prev.filter((x) => x.id !== p.id))
            }
            continue
          }
          const row = (await res.json()) as AnalysisScreening
          if (row.status === "analysing") continue

          // Finished. Record it, announce it, and stop watching it.
          notified.current.add(p.id)
          setFinished((prev) => ({
            ...prev,
            [p.id]: {
              ...row,
              id: p.id,
              patient_name: row.patient_name ?? p.patientName,
              finishedAt: Date.now(),
            },
          }))
          setPending((prev) => prev.filter((x) => x.id !== p.id))

          if (row.status === "error") {
            toast.error("Analysis failed", {
              description: `The screening for ${p.patientName} could not be completed. Open it to see why.`,
              duration: 12_000,
              action: {
                label: "View",
                onClick: () => navigate(`/dashboard/screenings/${p.id}`),
              },
            })
          } else {
            toast.success("Analysis complete", {
              description: `The screening for ${p.patientName} is ready.`,
              duration: 10_000,
              action: {
                label: "View",
                onClick: () => navigate(`/dashboard/screenings/${p.id}`),
              },
            })
          }
        } catch {
          /* the next tick tries again */
        }
      }
    }

    let running = false

    /* A hidden tab does not poll, and a slow request does not overlap the next
       tick. Phones suspend background tabs anyway, but not predictably -- some
       keep a throttled interval alive and spend the clinician's battery on
       answers nobody is looking at. Coming back fires visibilitychange, which
       checks at once rather than waiting out the interval. */
    const check = async () => {
      if (running || document.visibilityState === "hidden") return
      running = true
      try {
        await runCheck()
      } finally {
        running = false
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void check()
    }

    const id = window.setInterval(() => void check(), POLL_MS)
    document.addEventListener("visibilitychange", onVisibilityChange)
    // Check once straight away, so a result that landed between polls is not
    // made to wait out the remainder of the interval.
    void check()
    return () => {
      cancelled = true
      window.clearInterval(id)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [pending, navigate])

  /* Prune finished rows so the map cannot grow without bound. A screening that
     finished twenty minutes ago is not worth holding; the list and the result
     page are the record of it. */
  useEffect(() => {
    const id = window.setInterval(() => {
      setFinished((prev) => {
        const keys = Object.keys(prev)
        if (keys.length === 0) return prev
        const cutoff = Date.now() - FINISHED_TTL_MS
        const kept: Record<string, AnalysisScreening> = {}
        let dropped = false
        for (const k of keys) {
          if (prev[k].finishedAt && prev[k].finishedAt < cutoff) {
            dropped = true
            continue
          }
          kept[k] = prev[k]
        }
        return dropped ? kept : prev
      })
    }, 60_000)
    return () => window.clearInterval(id)
  }, [])

  const value = useMemo<WatcherValue>(() => ({
    track,
    untrack,
    isAnalysing: pending.length > 0,
    pendingCount: pending.length,
    finished,
  }), [track, untrack, pending.length, finished])

  return (
    <AnalysisWatcherContext.Provider value={value}>
      {children}
    </AnalysisWatcherContext.Provider>
  )
}

/**
 * The watcher, or a no-op version of it outside the provider.
 *
 * A no-op rather than a throw, so a component that asks for it in a context
 * where it does not exist renders normally instead of taking the page down.
 */
export function useAnalysisWatcher(): WatcherValue {
  const ctx = useContext(AnalysisWatcherContext)
  const fallback = useMemo<WatcherValue>(() => ({
    track: () => {},
    untrack: () => {},
    isAnalysing: false,
    pendingCount: 0,
    finished: {},
  }), [])
  return ctx ?? fallback
}
