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
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useAuth } from "@/hooks/useAuth"
import { apiFetch } from "@/lib/api"
import { supabase } from "@/lib/supabase"
import { useCachedData } from "@/hooks/useCachedData"
import { useCountUp } from "@/hooks/useCountUp"
import { renderResultBadges, ConfidenceChip, ScreeningStatusBadge } from "@/lib/badge-helpers"
import { EmptyState } from "@/components/EmptyState"
import { ServiceHealthPanel } from "@/components/ServiceHealthPanel"

interface Screening {
  id: string
  patient_name: string | null
  clinician_name: string | null
  respiratory_result: string | null
  respiratory_confidence: number | null
  status: string
  reviewed_by_name: string | null
  created_at: string
}

interface Stats {
  total: number
  healthy: number
  pneumonia: number
  copd: number
  pendingReview: number
  error: number
  /** Analyses still running, so they have no class yet. */
  analysing: number
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
    const res = await apiFetch("/api/users")
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
      const res = await apiFetch(`/api/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      })
      if (!res.ok) throw new Error("Failed")
      void refreshUsers()
    } catch { /* ignore */ }
  }, [accessToken, refreshUsers])

  const handleDashboardReject = useCallback(async (id: string) => {
    try {
      const res = await apiFetch(`/api/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "rejected" }),
      })
      if (!res.ok) throw new Error("Failed")
      void refreshUsers()
    } catch { /* ignore */ }
  }, [accessToken, refreshUsers])

  // Shared cache entry — "screenings" is the SAME payload Dashboard/Screenings use,
  const screeningsFetcher = useCallback(async (): Promise<Screening[]> => {
    const res = await apiFetch("/api/screenings")
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

  /* Keep "Recent Screenings" honest when the same account is working in two
     tabs -- a screening submitted on the wizard tab should appear here without
     waiting out the cache TTL.

     Only subscribes once a session exists, since RLS filters change events per
     subscriber and an anonymous channel would simply never match. Guarded on
     `accessToken` rather than `user` because the fetch is token-authenticated
     and subscribing earlier would refetch against no credentials. */
  useEffect(() => {
    if (!accessToken) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const channel = supabase
      .channel("public:screenings")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "screenings" },
        () => {
          if (timer) clearTimeout(timer)
          // Debounced: one screening submission touches the row more than once,
          // and each event here costs a refetch.
          timer = setTimeout(() => {
            void refreshScreenings()
          }, 250)
        }
      )
      .subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [accessToken, refreshScreenings])

  const stats: Stats = useMemo(() => {
    return {
      total: screenings.length,
      healthy: screenings.filter(s => s.respiratory_result === "Healthy").length,
      pneumonia: screenings.filter(s => s.respiratory_result === "Pneumonia").length,
      copd: screenings.filter(s => s.respiratory_result === "COPD").length,
      pendingReview: screenings.filter(s => s.status === "pending_review").length,
      error: screenings.filter(s => s.status === "error").length,
      // Still running, so it has no class yet and is in none of the three
      // class counts. It is in the total.
      analysing: screenings.filter(s => s.status === "analysing").length,
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

  const isAnonymous = (s: { patient_name: string | null }) => !s.patient_name

  const renderStatusBadge = (status: string, reviewedBy: string | null) => (
    <ScreeningStatusBadge status={status} reviewedBy={reviewedBy} />
  )

  /* Item 3: app-wide color legend — red = active infection risk (Pneumonia),
     yellow = chronic warning (COPD), green = healthy/cleared,
     neutral = plain counts. Matches the result badges used in every table. */
  /* "Positive" was on the COPD and Pneumonia cards and has been removed.

   It said nothing. Every card in this row is a count of the same thing -- a
   screening result -- so the card already means "how many screenings came back
   COPD". Adding the word pushed the label onto a second line on a phone,
   which is where the cut-off the owner reported came from. The two cards are
   now single words and sit on one line at 375px, matching "Healthy".

   The heading stays a two-line array because "Total Screenings" and
   "Registered Users" are genuinely two words of one phrase, and forcing those
   onto one line would cut them off instead. */

  const cards = [
    {
      title: ["Total", "Screenings"],
      value: stats.total,
      icon: FileText,
      tone: "neutral" as const,
      /* A screening whose analysis is still running is in the total but in
         none of the class counts, because it has no class yet. Without this
         note the row does not add up -- 12 total against 4 + 3 + 4 -- and
         looks like a counting bug rather than a screening in flight. */
      note: stats.analysing > 0 ? `${stats.analysing} analysing` : null,
    },
    {
      title: ["COPD"],
      value: stats.copd,
      icon: Stethoscope,
      tone: "copd" as const,
    },
    {
      title: ["Pneumonia"],
      value: stats.pneumonia,
      icon: Stethoscope,
      tone: "critical" as const,
    },
    {
      title: ["Healthy"],
      value: stats.healthy,
      icon: CheckCircle,
      tone: "healthy" as const,
    },
    ...(!isClinician
      ? [
          {
            title: ["Registered", "Users"],
            value: registeredCount,
            icon: Users,
            tone: "neutral" as const,
            suffix: <span className="ml-2 align-middle text-sm font-medium text-aura-muted">total</span>,
          },
        ]
      : []),
  ]

  const staggerProps = reduceMotion
    ? {}
    : { variants: staggerContainer, initial: "hidden" as const, animate: "visible" as const }
  const itemProps = reduceMotion
    ? {}
    : { variants: staggerItem, whileHover: cardHover.whileHover, whileTap: cardHover.whileTap }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen">
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
        <AlertTriangle className="h-10 w-10 text-aura-warning-strong" />
        <p className="text-aura-text">{error}</p>
        <Button onClick={() => void refreshScreenings()} className="gap-2">
          <RefreshCw className="h-4 w-4" /> Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
        {/* ═══ Welcome banner ═══ */}
        <div className="relative overflow-hidden bg-gradient-to-br from-[#0a352e] via-aura-forest to-aura-forest-light px-4 py-8 sm:px-6 lg:px-8">
          <div aria-hidden="true" className="absolute inset-0 aura-dots opacity-20" />
          <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-aura-accent/10 blur-[80px]" />
          <div className="relative z-10 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-white/15 bg-white/8 px-3 py-1 text-xs font-medium text-white/70 backdrop-blur-sm">
                  {todayLabel}
                </span>
                <span className="rounded-full bg-aura-accent/20 px-3 py-1 text-xs font-bold tracking-wide text-aura-forest">
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
                  className="h-10 gap-2 rounded-lg bg-white font-semibold text-aura-forest shadow-lg shadow-black/10 transition-all lg:hover:bg-white/95 lg:hover:shadow-xl"
                >
                  <Plus className="h-4 w-4" />
                  <span>New Screening</span>
                </Button>
              ) : (
                <Button
                  onClick={() => navigate("/dashboard/admin")}
                  className="h-10 gap-2 rounded-lg bg-white font-semibold text-aura-forest shadow-lg shadow-black/10 transition-all lg:hover:bg-white/95 lg:hover:shadow-xl"
                >
                  <Users className="h-4 w-4" />
                  <span>Add User</span>
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="px-4 pb-10 pt-8 sm:px-6 lg:px-8">

          <motion.div
            {...staggerProps}
            className={
              isClinician
                ? "grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4 lg:gap-5 items-stretch"
                : "grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5 lg:gap-5 items-stretch"
            }
          >
            {cards.map((card) => {
              const Icon = card.icon
              return (
                <motion.div key={card.title.join("-")} {...itemProps}>
                  <Card className="aura-panel h-full min-h-[124px]">
                    <CardContent className="flex h-full flex-col justify-between p-4 sm:p-5">
                      <div className="flex items-start justify-between gap-2 sm:gap-3">
                        {/* min-w-0 so a long label shrinks instead of pushing
                            the card wider; break-words so it wraps rather than
                            clipping when it must. */}
                        <p className="min-w-0 font-mono text-xs font-medium uppercase leading-[1.4] tracking-[0.06em] break-words text-aura-muted sm:tracking-[0.08em]">
                          {card.title.map((line) => <span key={line} className="block">{line}</span>)}
                        </p>
                        <span className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl sm:h-9 sm:w-9",
                          card.tone === "neutral" && "bg-aura-forest/10 text-aura-forest",
                          card.tone === "copd" && "bg-aura-warning/15 text-aura-warning-strong",
                          card.tone === "healthy" && "bg-aura-mint/15 text-aura-pine"
                        )}>
                          <Icon className="h-4 w-4" aria-hidden="true" />
                        </span>
                      </div>
                      <p className={cn(
                        "font-display text-[1.75rem] font-bold leading-none tabular-nums lg:text-4xl",
                        card.tone === "neutral" && "text-aura-ink",
                        card.tone === "critical" && "text-aura-coral-strong",
                        card.tone === "copd" && "text-aura-warning-strong",
                        card.tone === "healthy" && "text-aura-pine"
                      )}>
                        <AnimatedStat value={card.value} />
                      </p>
                      {/* Item 9: a zero on an alert-stat means "checked and clear",
                          not "no data" — say so explicitly. */}
                      {card.value === 0 && card.tone !== "neutral" && card.tone !== "healthy" && (
                        <p className="mt-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-aura-muted">
                          Checked &middot; clear
                        </p>
                      )}
                      {/* A screening still being analysed is in the total but
                          in none of the class counts. Saying so keeps the row
                          adding up. */}
                      {"note" in card && card.note && (
                        <p className="mt-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-aura-muted">
                          {card.note}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              )
            })}
            </motion.div>

            {/* Service health, full width.

                A clinician is the person who finds the system broken -- they
                are the one recording, and they are the one who needs to know
                whether the failure is theirs or the server's. So the
                diagnostic sits here, on the dashboard they land on, rather than
                behind the admin pages.

                Full width because it is a status strip, not a card to read: four
                services in a row on a wide screen, two by two on a phone or a
                tablet in portrait. */}
            <motion.div {...staggerProps} className="mt-6">
              <motion.div {...{ variants: staggerItem }}>
                <ServiceHealthPanel />
              </motion.div>
            </motion.div>

        {/* The second track only exists for roles that render the Needs
            Attention panel. A clinician has a single panel, so the two-column
            split would leave an empty 320px gap beside it. */}
        <div className={cn("mt-8 grid gap-6", !isClinician && "lg:grid-cols-[1fr_320px]")}>
          <motion.div {...staggerProps}>
            <motion.div {...{ variants: staggerItem }}>
              <Card className="aura-panel aura-panel-edge">
                <CardHeader className="aura-card-band px-6 py-5">
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-xl text-aura-ink">
                        <Activity className="h-6 w-6 text-aura-forest" aria-hidden="true" />
                        Recent Screenings
                      </CardTitle>
                      <p className="mt-1 text-base text-aura-muted">Latest respiratory assessments from your clinic</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigate("/dashboard/patient-records")}
                      className="gap-1 text-base text-aura-forest hover-tap:text-aura-ink"
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
                          View Patient Records
                        </Button>
                      }
                    />
                  ) : (
                    <div className="divide-y divide-aura-border-soft">
                      {recentScreenings.map((screening) => (
                        <Link
                          key={screening.id}
                          to={`/dashboard/screenings/${screening.id}`}
                          className="group flex w-full items-center justify-between gap-4 px-6 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-aura-brand hover-tap:bg-aura-surface-alt active:bg-aura-bg-alt"
                        >
                          {/* LEFT: the patient and the screening's details.

                              No avatar. The block of initials sat between the
                              row's left edge and the name, so the name was
                              never aligned with the card's own left padding
                              -- it was indented past a 48px square and the
                              gap after it. The name is the first thing in
                              the row now and lines up with the card's
                              content edge.

                              An anonymous screening still reads as one: the
                              name is set in italics as "Anonymous Screening",
                              which is the same signal the icon used to
                              give, and the wording is clearer than an icon
                              was. */}
                          <div className="min-w-0 flex-1">
                            <p className={cn(
                              "truncate text-base font-semibold",
                              isAnonymous(screening) ? "italic text-aura-muted" : "text-aura-ink"
                            )}>
                              {isAnonymous(screening) ? "Anonymous Screening" : screening.patient_name}
                            </p>
                            <p className="mt-1 truncate text-sm text-aura-muted">
                              {formatRelativeTime(screening.created_at)} · {shortDateFormat.format(new Date(screening.created_at))} · {screening.clinician_name || "—"}
                            </p>
                            {/* On a phone the badges have nowhere to sit
                                beside the name, so they go underneath it. */}
                            <div className="mt-2 flex flex-wrap items-center gap-2 sm:hidden">
                              {renderResultBadges(screening.respiratory_result)}
                              <ConfidenceChip value={screening.respiratory_confidence} />
                              {renderStatusBadge(screening.status, screening.reviewed_by_name)}
                            </div>
                          </div>

                          {/* RIGHT: the result badge, the confidence figure,
                              the status tag and the chevron, as one group
                              pinned to the right edge of the card.

                              The row is `justify-between`, so this group
                              sits hard against the right padding rather
                              than floating in the middle of the row, and
                              the space between the patient's details and
                              the badges is the deliberate gap of a
                              two-sided row rather than an accident of one
                              element growing to fill the row. */}
                          <div className="flex shrink-0 items-center gap-2">
                            <div className="hidden items-center gap-2 sm:flex">
                              {renderResultBadges(screening.respiratory_result)}
                              <ConfidenceChip value={screening.respiratory_confidence} />
                              {renderStatusBadge(screening.status, screening.reviewed_by_name)}
                            </div>
                            <ChevronRight className="h-5 w-5 shrink-0 text-aura-muted transition-transform duration-200 lg:group-hover:translate-x-0.5 group-hover-tap:text-aura-ink" />
                          </div>
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
              <Card className="aura-panel aura-panel-edge">
                <CardHeader className="aura-card-band px-6 py-5">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-base text-aura-ink">
                      <AlertTriangle className="h-5 w-5 text-aura-warning-strong" aria-hidden="true" />
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
                                    className="touch-target h-8 w-8 rounded-full transition-all hover-tap:bg-aura-mint-soft active:scale-90"
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
                                    className="touch-target h-8 w-8 rounded-full transition-all hover-tap:bg-aura-coral-soft active:scale-90"
                                    onClick={() => void handleDashboardReject(u.id)}
                                    aria-label={`Reject ${u.full_name}`}
                                  >
                                    <XCircle className="h-4 w-4 text-aura-coral-strong" />
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
                        <CheckCircle className="aura-pop-in h-6 w-6 text-aura-mint" aria-hidden="true" />
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
