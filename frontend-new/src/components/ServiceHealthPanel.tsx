import { useCallback, useEffect, useState } from "react"
import { Activity, Database, RefreshCw, Server, Waypoints } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { getApiUrl } from "@/lib/api"
import { supabase } from "@/lib/supabase"
import { describeLastSeen, isFresh, type ServiceStatus } from "@/lib/service-status"

interface Check {
  label: string
  icon: typeof Server
  state: "up" | "down" | "unknown"
  detail: string
}

const STATE_STYLE: Record<Check["state"], string> = {
  up: "bg-emerald-500",
  down: "bg-red-500",
  unknown: "bg-amber-500",
}

const STATE_TEXT: Record<Check["state"], string> = {
  up: "text-aura-pine",
  down: "text-red-700",
  unknown: "text-amber-700",
}

/**
 * Admin-only component health.
 *
 * This is the screen you open when the Login page is showing red. The Login page
 * tells a clinician whether to bother; this tells an administrator what is
 * actually wrong.
 *
 * Probes live where possible, falls back to the heartbeat row for detail, and
 * never throws -- a diagnostic tool that errors when the thing is broken is
 * useless.
 */
export function ServiceHealthPanel() {
  const [live, setLive] = useState<ServiceStatus | null>(null)
  const [beat, setBeat] = useState<{ checked_at?: string; inference_version?: string } | null>(null)
  const [reachable, setReachable] = useState<boolean | null>(null)
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      const res = await fetch(getApiUrl("/api/status"), { cache: "no-store" })
      if (res.ok) {
        setLive((await res.json()) as ServiceStatus)
        setReachable(true)
      } else {
        setReachable(false)
      }
    } catch {
      setReachable(false)
    }

    try {
      const { data } = await supabase
        .from("service_status")
        .select("checked_at, inference_version")
        .eq("id", true)
        .maybeSingle()
      setBeat(data ?? null)
    } catch {
      setBeat(null)
    }

    setCheckedAt(new Date().toISOString())
    setBusy(false)
  }, [])

  useEffect(() => {
    void refresh()
    const id = setInterval(refresh, 30_000)
    return () => clearInterval(id)
  }, [refresh])

  const beatAge = beat?.checked_at ? describeLastSeen(beat.checked_at) : ""
  const beatFresh = isFresh(beat?.checked_at)

  const checks: Check[] = [
    {
      label: "Backend API",
      icon: Server,
      state: reachable === null ? "unknown" : reachable ? "up" : "down",
      detail:
        reachable === null
          ? "Checking"
          : reachable
            ? "Responding"
            : beatFresh
              ? `Unreachable. Last heartbeat ${beatAge}`
              : beatAge
                ? `Unreachable. No heartbeat for ${beatAge}`
                : "Unreachable. No heartbeat recorded",
    },
    {
      label: "Database",
      icon: Database,
      state: live ? (live.database === "up" ? "up" : "down") : reachable === false ? "unknown" : "unknown",
      detail: live
        ? live.database === "up"
          ? "Supabase reachable"
          : "Not reachable"
        : "Unknown while the backend is down",
    },
    {
      label: "Inference",
      icon: Activity,
      state: live ? (live.inference === "up" ? "up" : "down") : "unknown",
      detail: live
        ? live.inference === "up"
          ? `Model ${beat?.inference_version ?? "loaded"}`
          : "Not reachable"
        : "Unknown while the backend is down",
    },
    {
      label: "Tunnel",
      icon: Waypoints,
      state: reachable ? "up" : "down",
      detail: reachable
        ? "Carrying traffic"
        : "If the backend is healthy but this page is not loaded, the tunnel is down",
    },
  ]

  return (
    <Card className="aura-panel rounded-2xl">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Service health</CardTitle>
          <CardDescription>
            Live probes plus the Mini PC heartbeat. Heartbeat
            {beatAge ? ` ${beatAge}` : ""}
            {beat?.checked_at ? "" : " — none recorded yet"}.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={busy}>
          <RefreshCw className={busy ? "mr-1.5 h-3.5 w-3.5 animate-spin" : "mr-1.5 h-3.5 w-3.5"} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        <ul className="m-0 grid list-none gap-3 sm:grid-cols-2">
          {checks.map((c) => (
            <li
              key={c.label}
              className="flex items-start gap-3 rounded-xl border border-aura-border-soft bg-aura-surface-alt p-4"
            >
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white">
                <c.icon className="h-4 w-4 text-aura-forest" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${STATE_STYLE[c.state]}`} aria-hidden="true" />
                  <p className="text-sm font-semibold text-aura-ink">{c.label}</p>
                  <Badge
                    variant="outline"
                    className={`border-transparent ${STATE_TEXT[c.state]}`}
                  >
                    {c.state}
                  </Badge>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-aura-muted">{c.detail}</p>
              </div>
            </li>
          ))}
        </ul>

        {checkedAt && (
          <p className="mt-4 text-xs text-aura-muted">
            Checked {new Date(checkedAt).toLocaleTimeString()}
          </p>
        )}
      </CardContent>
    </Card>
  )
}