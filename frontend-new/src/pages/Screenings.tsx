"use client"

import { useState, useMemo, useCallback, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { motion, useReducedMotion } from "framer-motion"
import { Search, Download, Eye, Loader2, SearchX, Check, MoreHorizontal, Activity, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useAuth } from "@/hooks/useAuth"
import { apiFetch } from "@/lib/api"
import { saveBlob } from "@/lib/download"
import { useCachedData } from "@/hooks/useCachedData"
import { staggerContainer, staggerItem } from "@/lib/motion"
import { cn } from "@/lib/utils"
import { getRespBadge, ScreeningStatusBadge } from "@/lib/badge-helpers"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"
import { EmptyState } from "@/components/EmptyState"
import { PageBanner } from "@/components/PageBanner"

interface Screening {
  id: string
  patient_id: string
  patient_name: string | null
  date_of_birth: string
  gender: string
  age_bracket: string
  clinic_name: string
  clinician_name: string
  respiratory_result: string | null
  respiratory_confidence: number | null
  respiratory_probabilities: Record<string, number> | null
  cascade_path: string
  model_version: string
  status: string
  reviewed_by_name: string | null
  reviewed_at: string | null
  review_notes: string | null
  audio_duration_sec: number | null
  created_at: string
}

type SortableField = keyof Pick<Screening, "patient_name" | "created_at" | "respiratory_result" | "status">

const createdDateFormat = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" })
const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })

/* Column header cell, shared by all four columns.
 *
 * The padding is px-4 because that is what the cells below use. The headers
 * were px-3 against the cells' px-4, so every heading sat four pixels to the
 * left of the data it labelled -- which is exactly the misalignment a heading
 * is supposed to prevent, and it is what made PATIENT look like it belonged
 * to the checkbox column instead of to the patient names.
 *
 * The colour is aura-ink rather than aura-muted. Muted grey on a header is a
 * label; ink is a heading. These four words are the only thing telling a
 * clinician what the columns are, and they are now the strongest thing in
 * the header row.
 *
 * One class string for all four so they cannot drift apart again. */
const HEAD_CELL =
  "px-4 text-left font-mono text-[14.5px] font-bold uppercase tracking-[0.08em] text-aura-ink"

function computeAgeLabel(screening: Screening): string {
  if (screening.age_bracket) return screening.age_bracket
  if (!screening.date_of_birth) return "—"
  const birthDate = new Date(screening.date_of_birth)
  if (isNaN(birthDate.getTime())) return "—"
  const today = new Date()
  let age = today.getFullYear() - birthDate.getFullYear()
  const monthDiff = today.getMonth() - birthDate.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--
  }
  return `${age}y`
}

export function Screenings({ embedded = false }: { embedded?: boolean }) {
  const { user, accessToken } = useAuth()
  const navigate = useNavigate()
  /* Matches the Dashboard banner's chip so the role reads the same on both. */
  const roleLabel = (user?.role || "").replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())
  const [search, setSearch] = useState("")
  const [classFilter, setClassFilter] = useState("all")
  const [genderFilter, setGenderFilter] = useState("all")
  const [detailScreening, setDetailScreening] = useState<Screening | null>(null)
  const [exporting, setExporting] = useState(false)

  /** Brief confirmation after a completed export so the button acknowledges. */
  const [exportDone, setExportDone] = useState(false)
  useEffect(() => {
    if (!exportDone) return
    const timer = window.setTimeout(() => setExportDone(false), 1600)
    return () => window.clearTimeout(timer)
  }, [exportDone])

  // Shared cache entry — Dashboard and the Screening wizard read the same key
  const screeningsFetcher = useCallback(async (): Promise<Screening[]> => {
    const res = await apiFetch("/api/screenings")
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || "Failed to load screenings")
    }
    return res.json()
  }, [accessToken])

  const { data: screeningsData, isLoading: loading } =
    useCachedData<Screening[]>(user && accessToken ? "screenings" : null, screeningsFetcher)
  const screenings = useMemo(() => screeningsData ?? [], [screeningsData])

  const reduceMotion = useReducedMotion()
  const staggerProps = reduceMotion
    ? {}
    : { variants: staggerContainer, initial: "hidden" as const, animate: "visible" as const }
  const itemProps = reduceMotion ? {} : { variants: staggerItem }

  /* The list order is fixed: newest screening first.

     The column headers used to be sort buttons with a caret indicator. They
     are now plain labels, so there is nothing left to change the order from,
     and the order it was already in -- newest first -- is the one that is
     useful when you open the list to find the screening you just did. Keeping
     it as a constant rather than as state also removes a re-render of the
     whole list on every header click. */
  const SORT_FIELD: SortableField = "created_at"

  const filteredAndSortedScreenings = useMemo(() => {
    let result = [...screenings]

    if (search) {
      const searchLower = search.toLowerCase()
      result = result.filter(s =>
        (s.patient_name ?? "").toLowerCase().includes(searchLower) ||
        (s.clinic_name ?? "").toLowerCase().includes(searchLower) ||
        (s.clinician_name ?? "").toLowerCase().includes(searchLower)
      )
    }

    if (classFilter !== "all") {
      result = result.filter(s => s.respiratory_result === classFilter)
    }

    if (genderFilter !== "all") {
      result = result.filter(s => s.gender === genderFilter)
    }

    // Newest first. The direction is fixed, so it is not a runtime choice.
    result.sort((a, b) => {
      const aVal = a[SORT_FIELD]
      const bVal = b[SORT_FIELD]
      if (aVal === null || aVal === undefined) return 1
      if (bVal === null || bVal === undefined) return -1
      return -String(aVal).localeCompare(String(bVal))
    })

    return result
  }, [screenings, search, classFilter, genderFilter])

  /*
   * Row selection drives which PDFs the bulk export writes. Selections are
   * scoped to whatever the current filters match, so ids that fall out of view
   * simply stop counting — they are never silently exported.
   */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())

  const selectedScreenings = useMemo(
    () => filteredAndSortedScreenings.filter(s => selectedIds.has(s.id)),
    [filteredAndSortedScreenings, selectedIds],
  )

  const selectedCount = selectedScreenings.length
  const allSelected =
    selectedCount > 0 && selectedCount === filteredAndSortedScreenings.length

  /* Checked + some-remaining reads as indeterminate, not unchecked. */
  const selectAllRef = useRef<HTMLInputElement>(null)
  const someSelected = selectedCount > 0 && !allSelected
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected
    }
  }, [someSelected])

  const toggleRow = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    setSelectedIds(prev => {
      const next = new Set<string>()
      const everythingPicked =
        filteredAndSortedScreenings.length > 0 &&
        filteredAndSortedScreenings.every(s => prev.has(s.id))
      if (!everythingPicked) {
        for (const s of filteredAndSortedScreenings) next.add(s.id)
      }
      return next
    })
  }, [filteredAndSortedScreenings])

  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])

  /* Selected rows win; with nothing ticked the export stays "everything the
     filters match", so the button is never a dead end. */
  const exportTargets = selectedCount > 0 ? selectedScreenings : filteredAndSortedScreenings

  const getStatusBadge = (status: string, reviewedBy: string | null) => (
    <ScreeningStatusBadge
      status={status}
      reviewedBy={reviewedBy}
      className="h-7 px-3 text-sm font-semibold"
    />
  )

  const fetchPdfBlob = useCallback(async (screeningId: string): Promise<Blob | null> => {
    const response = await apiFetch(`/api/screenings/${screeningId}/pdf`)
    if (!response.ok) return null
    return response.blob()
  }, [])

  const triggerDownload = (blob: Blob, filename: string) => {
    saveBlob(blob, filename)
  }

  const downloadPDF = useCallback(async (screeningId: string) => {
    try {
      const blob = await fetchPdfBlob(screeningId)
      if (!blob) {
        toast.error("Failed to download PDF")
        return
      }
      triggerDownload(blob, `aura-dx-screening-${screeningId.slice(0, 8)}.pdf`)
    } catch (error) {
      console.error("PDF download failed:", error)
      toast.error("Failed to download PDF")
    }
  }, [fetchPdfBlob])

  /*
   * Bulk export: one PDF, one page per record.
   *
   * This used to fetch a separate PDF per record and fire a download for each,
   * paced 350ms apart to avoid the browser's pop-up blocker. Twelve ticked
   * records produced twelve files -- no use as a handover pack -- and the
   * pacing made it slow enough that people stopped bothering.
   *
   * The server builds the whole document in one request and each screening is
   * laid out to occupy exactly one A4 page, so page N of the file is always a
   * whole patient rather than half a table carried over from the last.
   */
  const exportAllPDFs = useCallback(async () => {
    const targets = exportTargets
    if (targets.length === 0) {
      toast.error("No records to export")
      return
    }

    setExporting(true)
    const toastId = toast.loading(`Building a ${targets.length}-page report`)

    try {
      const res = await apiFetch("/api/screenings/export-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ screening_ids: targets.map(s => s.id) }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || "Export failed")
      }

      const blob = await res.blob()
      const stamp = new Date().toISOString().slice(0, 10)
      triggerDownload(blob, `aura-dx-screening-report-${stamp}.pdf`)

      setExportDone(true)
      /* Only clear on a clean run, so a partial failure leaves the ticks in
         place and the user can retry exactly the ones that did not land. */
      clearSelection()
      toast.success(
        `Exported ${targets.length} record${targets.length === 1 ? "" : "s"}`,
        { id: toastId }
      )
    } catch (error) {
      console.error("Bulk export failed:", error)
      toast.error(
        error instanceof Error ? error.message : "Export failed",
        { id: toastId }
      )
    } finally {
      setExporting(false)
    }
  }, [exportTargets, clearSelection])

  return (
    <div className="space-y-6">
      {!embedded && (
        <PageBanner
          eyebrow={
            <>
              {/* Count reads as the headline stat, so it gets tabular figures,
                  a bolder weight and a mint accent instead of the quiet
                  grey-on-white chip used for secondary metadata. */}
              <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/15 px-4 py-1.5 text-sm font-bold tabular-nums text-white backdrop-blur-sm">
                <span className="h-2 w-2 shrink-0 rounded-full bg-aura-accent" aria-hidden="true" />
                {filteredAndSortedScreenings.length} screening{filteredAndSortedScreenings.length === 1 ? "" : "s"}
                {filteredAndSortedScreenings.length !== screenings.length && (
                  <span className="font-medium text-white/70">of {screenings.length}</span>
                )}
              </span>
              {roleLabel && (
                <span className="rounded-full bg-aura-accent/20 px-3 py-1 text-sm font-bold tracking-wide text-aura-accent">
                  {roleLabel}
                </span>
              )}
            </>
          }
          title="Patient Records"
          subtitle={
            <span className="flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" aria-hidden="true" />
              Every respiratory screening recorded by your clinic
            </span>
          }
        />
      )}

      <motion.div {...staggerProps}>
        <motion.div {...itemProps}>
          <Card className="aura-panel aura-panel-edge overflow-hidden">
            <CardHeader className="aura-card-band sticky top-0 z-10 px-6 py-5 backdrop-blur-md">
              <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
                <div className="min-w-0">
                  {/* Icon + title reads as a section header, matching the
                      Dashboard's "Recent Screenings" card. */}
                  <CardTitle className="flex items-center gap-2 font-display text-2xl font-semibold text-aura-ink">
                    <Activity className="h-6 w-6 shrink-0 text-aura-forest" aria-hidden="true" />
                    All Screenings
                  </CardTitle>
                  {/* Count sits in its own pill so it reads as a header stat
                      rather than trailing sentence text. */}
                  <p className="mt-2 flex items-center gap-2 text-sm text-aura-muted">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-aura-surface-alt px-3 py-1 text-sm font-semibold tabular-nums text-aura-forest">
                      {filteredAndSortedScreenings.length} of {screenings.length}
                    </span>
                    <span>records shown</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void exportAllPDFs()}
                  disabled={exporting || filteredAndSortedScreenings.length === 0}
                  className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-md bg-aura-forest px-5 text-base font-semibold text-white transition-colors hover:bg-aura-forest-light disabled:pointer-events-none disabled:opacity-50"
                >
                  {exporting ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : exportDone ? (
                    <Check className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Download className="h-4 w-4" aria-hidden="true" />
                  )}
                  {exporting ? "Exporting…" : exportDone ? "Exported" : "Export PDF"}
                </button>
              </div>
              <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
                <div className="relative max-w-xs flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-aura-muted" aria-hidden="true" />
                  <Input
                    type="search"
                    placeholder="Patient, clinic, clinician…"
                    aria-label="Search screenings by patient, clinic, or clinician"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="h-11 pl-9"
                  />
                </div>
                <Select value={classFilter} onValueChange={setClassFilter}>
                  <SelectTrigger className="h-11 w-full text-base md:w-[180px]" aria-label="Filter by result class">
                    <SelectValue placeholder="Class" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="Healthy">Healthy</SelectItem>
                    <SelectItem value="COPD">COPD</SelectItem>
                    <SelectItem value="Pneumonia">Pneumonia</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={genderFilter} onValueChange={setGenderFilter}>
                  <SelectTrigger className="h-11 w-full text-base md:w-[170px]" aria-label="Filter by gender">
                    <SelectValue placeholder="Gender" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                  </SelectContent>
                </Select>
                {selectedCount > 0 && (
                  <div className="flex h-11 shrink-0 items-center gap-2 md:ml-auto">
                    <span className="flex h-7 items-center rounded-full bg-aura-mint-wash px-3 text-sm font-semibold tabular-nums text-aura-forest">
                      {selectedCount} selected
                    </span>
                    <button
                      type="button"
                      onClick={clearSelection}
                      className="rounded-md px-1.5 py-1 text-sm font-medium text-aura-muted transition-colors hover:text-aura-forest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-forest"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
          {loading ? (
            <div className="space-y-3 p-6" role="status" aria-live="polite">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between gap-4 rounded-lg border border-aura-forest/10 bg-white px-4 py-3">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="h-6 w-20 rounded-full" />
                  <Skeleton className="h-3 w-24" />
                </div>
              ))}
            </div>
          ) : filteredAndSortedScreenings.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="No Screenings Found"
              hint="Try adjusting your search or filters"
            />
          ) : (
            <>
            {/* Mobile: one card per screening. The table below is six columns
                including a checkbox and a 32px action trigger; at 375px that is
                about 50px per column, with the date clipped and the result
                badge wrapping. A card gives the patient name room, the result
                somewhere to sit, and the actions a full-width row.

                Hidden from `md` up, where the table fits. Both render the same
                `filteredAndSortedScreenings`, so search, sort and the PDF
                selection all apply to both. */}
            <ul className="m-0 flex list-none flex-col gap-3 p-0 md:hidden">
              {filteredAndSortedScreenings.map((screening, idx) => {
                const isSelected = selectedIds.has(screening.id)
                const label = screening.patient_name || "Anonymous Screening"
                return (
                  <li
                    key={screening.id}
                    className={cn(
                      "rounded-xl border bg-white p-4 transition-colors",
                      isSelected
                        ? "border-aura-forest/40 bg-aura-mint-wash/60"
                        : "border-aura-forest/10",
                      idx % 2 === 1 && !isSelected && "bg-aura-table-stripe"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      {/* 44x44 label so the checkbox clears the tap-target
                          floor; the box itself stays 18px. */}
                      <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center">
                        <Checkbox
                          className="h-[18px] w-[18px] accent-aura-forest"
                          checked={isSelected}
                          onChange={() => toggleRow(screening.id)}
                          aria-label={`Select ${label} for PDF export`}
                        />
                      </label>

                      <div className="min-w-0 flex-1">
                        <div className="text-base font-medium">{label}</div>
                        <div className="text-sm text-aura-muted">
                          {screening.clinician_name}
                        </div>
                      </div>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="touch-target h-8 w-8 shrink-0 rounded-full text-aura-muted transition-[transform,background-color,color] duration-150 hover:bg-aura-mint-wash hover:text-aura-forest motion-safe:hover:scale-[1.08]"
                            aria-label={`Actions for ${label}`}
                          >
                            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuLabel className="text-xs font-normal text-aura-muted">
                            {label}
                          </DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onSelect={() => navigate(`/dashboard/screenings/${screening.id}`)}
                            className="gap-2"
                          >
                            <Eye className="h-4 w-4" aria-hidden="true" />
                            View details
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => void downloadPDF(screening.id)}
                            className="gap-2"
                          >
                            <Download className="h-4 w-4" aria-hidden="true" />
                            Download PDF
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {/* Result, status and date on one wrapping row rather than
                        three columns. */}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {getRespBadge(screening.respiratory_result)}
                      {getStatusBadge(screening.status, screening.reviewed_by_name)}
                      <span className="text-sm tabular-nums text-aura-muted">
                        {createdDateFormat.format(new Date(screening.created_at))}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>

            {/* Table, from `md` up. */}
            <div className="hidden max-h-[600px] overflow-auto overscroll-contain md:block">
              <Table>
                <TableHeader className="aura-table-head sticky top-0 z-10 border-b border-aura-forest/10">
                  <TableRow>
                    <TableHead className="w-12 px-2">
                      <label className="inline-flex cursor-pointer items-center">
                        <Checkbox
                          ref={selectAllRef}
                          className="h-[18px] w-[18px] accent-aura-forest"
                          checked={allSelected}
                          onChange={toggleSelectAll}
                          disabled={filteredAndSortedScreenings.length === 0}
                          aria-label="Select all screenings for export"
                        />
                      </label>
                    </TableHead>
                    {/* Plain bold column labels.

                        These were buttons carrying a sort indicator -- a pair of
                        up/down carets, one of them lit to show the current
                        direction. Two problems: the carets were the busiest
                        thing in a header row that is otherwise four words, and
                        every column showed a double caret whether or not it
                        was sortable, so the row read as a set of filters
                        rather than as labels.

                        The labels are now text, so nothing in the header row
                        looks clickable. The order the list is in does not
                        change -- newest first, as it always was -- it is just
                        no longer something the header can change.
                        aria-sort goes with the affordance: a column that
                        cannot be sorted must not announce that it can be. */}
                    <TableHead className={HEAD_CELL}>
                      Patient
                    </TableHead>
                    <TableHead className={HEAD_CELL}>
                      Result
                    </TableHead>
                    <TableHead className={HEAD_CELL}>
                      Status
                    </TableHead>
                    <TableHead className={HEAD_CELL}>
                      Date
                    </TableHead>
                    <TableHead className="w-20 text-right font-mono text-[14.5px] font-bold uppercase tracking-[0.08em] text-aura-ink" aria-label="Row actions" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAndSortedScreenings.map((screening, idx) => (
                    <TableRow
                      key={screening.id}
                      className={cn(
                        "group align-middle overflow-hidden border-b border-aura-forest/10 transition-colors duration-150 hover:bg-aura-mint-wash/60 focus-within:bg-aura-mint-wash/60",
                        idx % 2 === 1 && "bg-aura-table-stripe"
                      )}
                    >
                      <TableCell className="w-12 px-2 align-middle">
                        <label className="inline-flex h-11 w-11 cursor-pointer items-center justify-center">
                          <Checkbox
                            className="h-[18px] w-[18px] accent-aura-forest"
                            checked={selectedIds.has(screening.id)}
                            onChange={() => toggleRow(screening.id)}
                            aria-label={`Select ${screening.patient_name || "anonymous screening"} for PDF export`}
                          />
                        </label>
                      </TableCell>
                      <TableCell className="relative px-4 align-middle">
                        {/* Monogram-style hover accent bar. It lives inside the
                            cell because a bare <span> as a direct child of
                            <tr> gets hoisted out of the table by the HTML
                            parser, which breaks column alignment. */}
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-y-1.5 left-0 w-[3px] origin-center scale-y-0 rounded-full bg-aura-forest transition-transform duration-150 motion-safe:group-hover:scale-y-100 motion-safe:group-focus-within:scale-y-100"
                        />
                        <div className="text-base font-medium">{screening.patient_name || "Anonymous Screening"}</div>
                        <div className="text-sm text-aura-muted">{screening.clinician_name}</div>
                      </TableCell>
                      <TableCell className="px-4 align-middle">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {getRespBadge(screening.respiratory_result)}
                        </div>
                      </TableCell>
                      <TableCell className="px-4 align-middle">{getStatusBadge(screening.status, screening.reviewed_by_name)}</TableCell>
                      <TableCell className="px-4 align-middle whitespace-nowrap text-base tabular-nums text-aura-muted">
                        {createdDateFormat.format(new Date(screening.created_at))}
                      </TableCell>
                      <TableCell className="px-4 align-middle text-right">
                        <div className="flex items-center justify-end gap-1">
                          {/* View / Download collapse into one trigger so the
                              column stays narrow. */}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="touch-target h-8 w-8 rounded-full text-aura-muted transition-[transform,background-color,color] duration-150 hover:bg-aura-mint-wash hover:text-aura-forest motion-safe:hover:scale-[1.08]"
                                aria-label={`Actions for ${screening.patient_name || "anonymous screening"}`}
                              >
                                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              <DropdownMenuLabel className="text-xs font-normal text-aura-muted">
                                {screening.patient_name || "Anonymous Screening"}
                              </DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onSelect={() => navigate(`/dashboard/screenings/${screening.id}`)}
                                className="gap-2"
                              >
                                <Eye className="h-4 w-4" aria-hidden="true" />
                                View details
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => void downloadPDF(screening.id)}
                                className="gap-2"
                              >
                                <Download className="h-4 w-4" aria-hidden="true" />
                                Download PDF
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            </>
          )}
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>
    </div>
  )
}