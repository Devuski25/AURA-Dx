"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { motion, useReducedMotion } from "framer-motion"
import { staggerContainer, staggerItem, cardHover } from "@/lib/motion"
import { cn } from "@/lib/utils"
import {
  FileText,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Stethoscope,
  RefreshCw,
  ChevronRight,
  ArrowRight,
  Clock,
  Users,
  Activity,
  Plus,
} from "lucide-react"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useAuth } from "@/hooks/useAuth"
import { getApiUrl } from "@/lib/api"
import { useCachedData } from "@/hooks/useCachedData"
import { useCountUp } from "@/hooks/useCountUp"
import { getResultBadge } from "@/lib/badge-helpers"
import { EmptyState } from "@/components/EmptyState"

interface Screening {
  id: string
  patient_name: string
  clinician_name: string
  tb_result: string
  respiratory_result: string | null
  status: string
  reviewed_by_name: string | null
  created_at: string
}

interface Stats {
  total: number
  tb_positive: number
  tb_negative: number
  healthy: number
  pneumonia: number
  copd: number
  pendingReview: number
  error: number
}

const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "narrow" })
const shortDateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" })

function formatRelativeTime(dateStr: string) {
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return relativeFormat.format(-mins, "minute")
  const hours = Math.floor(mins / 60)
  if (hours < 24) return relativeFormat.format(-hours, "hour")
  const days = Math.floor(hours / 24)
  if (days < 7) return relativeFormat.format(-days, "day")
  return shortDateFormat.format(new Date(dateStr))
}

function AnimatedStat({ value }: { value: number }) {
  const shown = useCountUp(value)
  return <>{shown}</>
}

export function Dashboard() {
  const { user, accessToken, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const reduceMotion = useReducedMotion()
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const canManageUsers = user?.role === "admin" || user?.role === "super_admin"
  const isClinician = user?.role === "clinician"
  const usersFetcher = useCallback(async (): Promise<any[]> => {
    const res = await fetch(getApiUrl("/api/users"), {
      headers: { Authorization: `Bearer ${accessToken ?? ""}` },
    })
    if (!res.ok) return []
    return res.json()
  }, [accessToken])
  const { data: usersData, refresh: refreshUsers } = useCachedData<any[]>(
    canManageUsers ? "dashboard-users" : null,
    usersFetcher,
    { ttlMs: 15_000 },
  )
  const users = useMemo(() => usersData ?? [], [usersData])
  const registeredCount = users.length
  const pendingAccounts = useMemo(() => users.filter(u => u.status === "pending"), [users])

  const handleDashboardApprove = useCallback(async (id: string) => {
    try {
      const res = await fetch(getApiUrl(`/api/users/${id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken ?? ""}` },
        body: JSON.stringify({ status: "approved" }),
      })
      if (!res.ok) throw new Error("Failed")
      void refreshUsers()
    } catch { /* ignore */ }
  }, [accessToken, refreshUsers])

  const handleDashboardReject = useCallback(async (id: string) => {
    try {
      const res = await fetch(getApiUrl(`/api/users/${id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken ?? ""}` },
        body: JSON.stringify({ status: "rejected" }),
      })
      if (!res.ok) throw new Error("Failed")
      void refreshUsers()
    } catch { /* ignore */ }
  }, [accessToken, refreshUsers])

  // Shared cache entry — Screenings list and the Screening wizard reuse this key
  const screeningsFetcher = useCallback(async (): Promise<Screening[]> => {
    const res = await fetch(getApiUrl("/api/screenings"), {
      headers: { Authorization: `Bearer ${accessToken ?? ""}` },
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || "Failed to load screenings")
    }
    return res.json()
  }, [accessToken])

  const { data: screeningsData, isLoading: loading, error: loadError, refresh: refreshScreenings } =
    useCachedData<Screening[]>(user && accessToken ? "screenings" : null, screeningsFetcher)
  const screenings = useMemo(() => screeningsData ?? [], [screeningsData])
  const error = loadError

  useEffect(() => {
    if (screeningsData) setLastUpdated(new Date())
  }, [screeningsData])

  const stats: Stats = useMemo(() => {
    return {
      total: screenings.length,
      tb_positive: screenings.filter(s => s.tb_result === "TB").length,
      tb_negative: screenings.filter(s => s.tb_result === "Non-TB").length,
      healthy: screenings.filter(s => s.respiratory_result === "Healthy").length,
      pneumonia: screenings.filter(s => s.respiratory_result === "Pneumonia").length,
      copd: screenings.filter(s => s.respiratory_result === "COPD").length,
      pendingReview: screenings.filter(s => s.status === "pending_review").length,
      error: screenings.filter(s => s.status === "error").length,
    }
  }, [screenings])

  const recentScreenings = screenings.slice(0, 6)

  const hour = new Date().getHours()
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"
  const firstName = user?.full_name?.trim() ? user.full_name.split(" ")[0] : "Clinician"
  const todayLabel = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(lastUpdated ?? new Date())
  const timeLabel = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(lastUpdated ?? new Date())
  const roleLabel = (user?.role || "").replace("_", " ").replace(/\b\w/g, c => c.toUpperCase())

  const renderStatusBadge = (status: string, reviewedBy: string | null) => {
    if (status === "pending_review") return <Badge variant="warning">Pending Review</Badge>
    if (reviewedBy) return <Badge variant="success">Reviewed</Badge>
    return <Badge variant="secondary">{status}</Badge>
  }

  const cards = [
    {
      title: ["Total", "Screenings"],
      value: stats.total,
      icon: FileText,
      tone: "neutral" as const,
    },
    {
      title: ["TB", "Positive"],
      value: stats.tb_positive,
      icon: AlertTriangle,
      tone: "tb-alert" as const,
    },
    {
      title: ["COPD", "Positive"],
      value: stats.copd,
      icon: Stethoscope,
      tone: "alert" as const,
    },
    {
      title: ["Pneumonia", "Positive"],
      value: stats.pneumonia,
      icon: XCircle,
      tone: "alert" as const,
    },
    {
      title: ["Healthy"],
      value: stats.healthy,
      icon: CheckCircle,
      tone: "healthy" as const,
    },
  ]

  const staggerProps = reduceMotion
    ? {}
    : { variants: staggerContainer, initial: "hidden" as const, animate: "visible" as const }
  const itemProps = reduceMotion
    ? {}
    : { variants: staggerItem, whileHover: cardHover.whileHover, whileTap: cardHover.whileTap }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-aura-surface">
        <div className="w-full px-4 pb-10 pt-8 sm:px-6 lg:px-8" role="status" aria-live="polite" aria-label="Loading dashboard">
          {/* Header block */}
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div className="space-y-3">
              <div className="flex gap-2">
                <Skeleton className="h-6 w-44 rounded-full" />
                <Skeleton className="h-6 w-24 rounded-full" />
              </div>
              <Skeleton className="h-10 w-72" />
              <Skeleton className="h-5 w-60" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-10 w-36 rounded-lg" />
              <Skeleton className="h-10 w-32 rounded-lg" />
              <Skeleton className="h-10 w-10 rounded-lg" />
            </div>
          </div>
          {/* Stat cards */}
          <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 lg:gap-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-[124px] rounded-2xl" />
            ))}
          </div>
          {/* Activity chart */}
          <Skeleton className="mt-6 h-[104px] rounded-2xl" />
          {/* Recent + attention panels */}
        <div className={cn("mt-6 grid gap-6", !isClinician && "lg:grid-cols-[1fr_320px]")}>
            <Skeleton className="h-[420px] rounded-2xl" />
            <Skeleton className="h-[420px] rounded-2xl" />
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
        <AlertTriangle className="h-10 w-10 text-aura-warning" />
        <p className="text-aura-text">{error}</p>
        <Button onClick={() => void refreshScreenings()} className="gap-2">
          <RefreshCw className="h-4 w-4" /> Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-aura-surface">
        {/* ─── Welcome banner ─── */}
        <div className="relative overflow-hidden bg-gradient-to-br from-[#0a352e] via-aura-forest to-aura-forest-light px-4 py-8 sm:px-6 lg:px-8">
          <div aria-hidden="true" className="absolute inset-0 aura-dots opacity-20" />
          <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-aura-accent/10 blur-[80px]" />
          <div className="relative z-10 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-white/15 bg-white/8 px-3 py-1 text-xs font-medium text-white/70 backdrop-blur-sm">
                  {todayLabel}
                </span>
                <span className="rounded-full bg-aura-accent/20 px-3 py-1 text-xs font-bold tracking-wide text-aura-accent">
                  {roleLabel || "Clinician"}
                </span>
              </div>
              <h1 className="mt-4 font-display text-3xl font-bold tracking-tight text-white md:text-4xl">
                {greeting}, {firstName}
              </h1>
              <p className="mt-2 flex items-center gap-1.5 text-sm text-white/60">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                Respiratory care overview · Updated {timeLabel}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isClinician ? (
                <Button
                  onClick={() => navigate("/dashboard/screening")}
                  className="h-10 gap-2 rounded-lg bg-white font-semibold text-aura-forest shadow-lg shadow-black/10 transition-all hover:bg-white/95 hover:shadow-xl"
                >
                  <Plus className="h-4 w-4" />
                  <span>New Screening</span>
                </Button>
              ) : (
                <Button
                  onClick={() => navigate("/dashboard/admin")}
                  className="h-10 gap-2 rounded-lg bg-white font-semibold text-aura-forest shadow-lg shadow-black/10 transition-all hover:bg-white/95 hover:shadow-xl"
                >
                  <Users className="h-4 w-4" />
                  <span>Add User</span>
                </Button>
              )}
              <Button
                onClick={() => void refreshScreenings()}
                size="icon"
                className="h-10 w-10 rounded-lg border border-white/20 bg-white/10 text-white backdrop-blur-sm transition-all hover:border-white/35 hover:bg-white/20"
                aria-label="Refresh dashboard"
                title="Refresh dashboard"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        <div className="px-4 pb-10 pt-8 sm:px-6 lg:px-8">

          <motion.div {...staggerProps} className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 lg:gap-5">
            {cards.map((card) => {
              const Icon = card.icon
              return (
                <motion.div key={card.title.join("-")} {...itemProps}>
                  <Card className={cn(
                    "h-full min-h-[124px] rounded-2xl border border-aura-border-soft shadow-aura-card transition-all duration-300 hover:shadow-aura-card-hover",
                    card.tone === "neutral" && "bg-white",
                    card.tone === "tb-alert" && "border-l-aura-coral bg-aura-coral-soft",
                    card.tone === "alert" && "border-l-aura-warning-strong bg-aura-warning-soft",
                    card.tone === "healthy" && "border-l-aura-mint bg-aura-mint-soft"
                  )}>
                    <CardContent className="flex h-full flex-col justify-between p-4">
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-mono text-[10px] font-medium uppercase leading-[1.4] tracking-[0.08em] text-aura-muted">
                          {card.title.map((line) => <span key={line} className="block">{line}</span>)}
                        </p>
                      <span className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                        card.tone === "neutral" && "bg-aura-forest/10 text-aura-forest",
                          card.tone === "tb-alert" && "bg-aura-elevated/80 text-aura-coral",
                          card.tone === "alert" && "bg-aura-elevated/80 text-aura-warning-strong",
                          card.tone === "healthy" && "bg-aura-elevated/80 text-aura-mint"
                        )}>
                          <Icon className="h-4 w-4" aria-hidden="true" />
                        </span>
                      </div>
                      <p className={cn(
                        "font-display text-3xl font-bold leading-none tabular-nums lg:text-4xl",
                        card.tone === "neutral" && "text-aura-ink",
                        card.tone === "tb-alert" && "text-aura-coral",
                        card.tone === "alert" && "text-aura-warning-strong",
                        card.tone === "healthy" && "text-aura-mint"
                      )}>
                        <AnimatedStat value={card.value} />
                      </p>
                    </CardContent>
                  </Card>
                </motion.div>
              )
            })}
            </motion.div>

          {!isClinician && (
          <motion.div {...staggerProps} className="mt-6">
            <motion.div {...{ variants: staggerItem }}>
            <Card className="rounded-2xl border border-aura-border-soft bg-white shadow-aura-card transition-shadow duration-300 hover:shadow-aura-card-hover">
              <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:gap-8">
                <div className="shrink-0">
                  <p className="font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-aura-muted">
                    Registered Users
                  </p>
                  <p className="mt-1 font-display text-3xl font-semibold leading-none tabular-nums text-aura-ink">
                    {registeredCount}
                    <span className="ml-2 align-middle text-sm font-medium text-aura-muted">total</span>
                  </p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
          )}

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
          <motion.div {...staggerProps}>
            <motion.div {...{ variants: staggerItem }}>
              <Card className="rounded-2xl border border-aura-border-soft bg-white shadow-aura-card transition-shadow duration-300 hover:shadow-aura-card-hover">
                <CardHeader className="border-b border-aura-border-soft px-6 py-5">
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-lg text-aura-ink">
                        <Activity className="h-5 w-5 text-aura-forest" aria-hidden="true" />
                        Recent Screenings
                      </CardTitle>
                      <p className="mt-1 text-sm text-aura-muted">Latest respiratory assessments from your clinic</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigate("/dashboard/patient-records")}
                      className="gap-1 text-aura-forest hover:text-aura-ink"
                    >
                      View All <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {recentScreenings.length === 0 ? (
                    <EmptyState
                      icon={FileText}
                      title="No screenings yet"
                      hint="Screenings you create will appear here."
                      action={
                        <Button size="sm" onClick={() => navigate("/dashboard/patient-records")} className="gap-1.5">
                          <Users className="h-3.5 w-3.5" />
                          View Patients
                        </Button>
                      }
                    />
                  ) : (
                    <div className="divide-y divide-aura-border-soft">
                      {recentScreenings.map((screening) => (
                        <Link
                          key={screening.id}
                          to={`/dashboard/screenings/${screening.id}`}
                          className="group flex w-full items-center gap-4 px-6 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-aura-brand hover:bg-aura-surface-alt active:bg-aura-bg-alt"
                        >
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-aura-forest/10 font-semibold text-aura-forest">
                            {screening.patient_name.split(" ").map((part) => part[0]).slice(0, 2).join("")}
                          </div>

                          <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold text-aura-ink">{screening.patient_name}</p>
                            <p className="mt-1 truncate text-xs text-aura-muted">
                              {formatRelativeTime(screening.created_at)} · {shortDateFormat.format(new Date(screening.created_at))} · {screening.clinician_name || "—"}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2 sm:hidden">
                              {getResultBadge(screening.tb_result, screening.respiratory_result)}
                              {renderStatusBadge(screening.status, screening.reviewed_by_name)}
                            </div>
                          </div>

                          <div className="hidden shrink-0 items-center gap-2 sm:flex">
                            {getResultBadge(screening.tb_result, screening.respiratory_result)}
                            {renderStatusBadge(screening.status, screening.reviewed_by_name)}
                          </div>

                          <ChevronRight className="h-5 w-5 shrink-0 text-aura-muted transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-aura-ink" />
                        </Link>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>

          {!isClinician && (
          <motion.div {...staggerProps} className="flex flex-col">
            <motion.div {...{ variants: staggerItem }} className="flex flex-col">
              <Card className="rounded-2xl border border-aura-border-soft bg-white shadow-aura-card transition-shadow duration-300 hover:shadow-aura-card-hover">
                <CardHeader className="border-b border-aura-border-soft px-6 py-5">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-base text-aura-ink">
                      <AlertTriangle className="h-5 w-5 text-aura-warning" aria-hidden="true" />
                      Needs Attention
                    </CardTitle>
                    {pendingAccounts.length > 0 && (
                      <span className="rounded-full bg-aura-warning-soft px-2.5 py-0.5 text-xs font-bold tabular-nums text-aura-warning-strong">
                        {pendingAccounts.length}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-aura-muted">Accounts awaiting approval</p>
                </CardHeader>
                <CardContent className="p-0">
                  {canManageUsers && pendingAccounts.length > 0 ? (
                    <div className="relative">
                      <div className="h-[390px] divide-y divide-aura-border-soft overflow-y-auto overscroll-contain pb-12 scrollbar-thin">
                        {pendingAccounts.map((u) => (
                          <div
                            key={u.id}
                            className="flex w-full items-center justify-between gap-4 px-6 py-4"
                          >
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-aura-ink">{u.full_name}</p>
                              <p className="truncate text-xs text-aura-muted">{u.email}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="touch-target h-8 w-8 rounded-full transition-all hover:bg-aura-mint-soft active:scale-90"
                                    onClick={() => void handleDashboardApprove(u.id)}
                                    aria-label={`Approve ${u.full_name}`}
                                  >
                                    <CheckCircle className="h-4 w-4 text-aura-mint" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Approve user</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="touch-target h-8 w-8 rounded-full transition-all hover:bg-aura-coral-soft active:scale-90"
                                    onClick={() => void handleDashboardReject(u.id)}
                                    aria-label={`Reject ${u.full_name}`}
                                  >
                                    <XCircle className="h-4 w-4 text-aura-coral" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Reject user</TooltipContent>
                              </Tooltip>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white via-white/90 to-transparent" />
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-aura-mint-soft">
                        <CheckCircle className="h-6 w-6 text-aura-mint" />
                      </div>
                      <p className="text-sm font-medium text-aura-ink">Everything Is Up To Date</p>
                      <p className="text-xs text-aura-muted">No accounts are awaiting approval</p>
                      {canManageUsers && (
                          <Button size="sm" variant="outline" className="mt-2" onClick={() => navigate("/dashboard/admin")}>
                          Manage Users
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
          )}
        </div>
      </div>

    </div>
  )
}
