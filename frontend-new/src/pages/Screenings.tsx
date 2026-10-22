"use client"

import { useState, useMemo, useCallback, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { motion, useReducedMotion } from "framer-motion"
import { Search, Download, Eye, Loader2, SearchX, Check, MoreHorizontal, Activity, FileText, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { useCachedData, invalidate } from "@/hooks/useCachedData"
import { staggerContainer, staggerItem } from "@/lib/motion"
import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"
import { EmptyState } from "@/components/EmptyState"
import { PageBanner } from "@/components/PageBanner"

/** One patient, and every screening they have. */
interface PatientGroup {
  /** Stable key for the group. */
  key: string
  patient_id: string
  name: string
  clinician_name: string
  clinic_name: string
  gender: string | null
  /** How many screenings this patient has. */
  count: number
  /** Their most recent screening -- what the row shows. */
  latest: Screening
  /** Every distinct result class they have had. */
  results: string[]
}

interface Screening {
  id: string
  patient_id: string
  patient_name: string | null
  date_of_birth: string
  /** The patient's sex.
   *
   * The API calls this `patient_gender`, not `gender`, and reading the
   * wrong one is why the gender filter appeared to do nothing: every row had
   * `gender` undefined, so nothing ever matched. */
  patient_gender: string | null
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
  /** Which screening this is for the patient, and how many they have. */
  screening_number: number | null
  patient_screening_count: number | null
}

/* Column header cell, shared by every labelled column.
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

  /* Who took the readings is only worth showing to somebody who can see other
     clinicians' patients.

     A clinician sees only the patients they created, so the name would be
     their own repeated down every row -- a column of the same word. An admin
     sees the whole clinic, and for them it is the one thing on the row that
     says whose patient this is. */
  const showClinician = user?.role === "admin" || user?.role === "super_admin"
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

  /* The list order is fixed: most recent activity first.

     The column headers used to be sort buttons with a caret indicator. They
     are now plain labels, so there is nothing left to change the order from,
     and the order it was already in -- newest first -- is the one that is
     useful when you open the list to find the screening you just did.

     The ordering happens where the groups are built, because a row is a
     patient now and a patient's place in the list is decided by their most
     recent screening. */

  /* Every screening of each patient, grouped.

     Used by the selection and the export, both of which work in whole
     patients: a row is a patient, and a handover pack is a patient's history
     rather than a scatter of snapshots.

     It is built from the unfiltered list, so a screening the current filters
     are hiding is still part of the patient's history. */
  const screeningsByPatient = useMemo(() => {
    const byPatient = new Map<string, Screening[]>()
    for (const s of screenings) {
      const list = byPatient.get(s.patient_id)
      if (list) list.push(s)
      else byPatient.set(s.patient_id, [s])
    }
    // Oldest first within a patient, so the numbers run 1, 2, 3.
    for (const list of byPatient.values()) {
      list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    }
    return byPatient
  }, [screenings])

  /* One row per patient.

     A patient can be screened as many times as clinically needed, so a list
     with a row per screening is the same patient repeated. The row shows their
     most recent reading and how many readings they have; the 3-dot menu opens
     their record, which shows all of them.

     Grouped by the patient's id, because that is the only thing that
     identifies a person. Two different patients can share a name, and the
     doctor who created them can be the same, so grouping by name-and-doctor
     would merge two people into one row. The name and the doctor are what the
     row DISPLAYS; the id is what it groups by. */
  const patientGroups = useMemo<PatientGroup[]>(() => {
    const byPatient = new Map<string, Screening[]>()
    for (const s of screenings) {
      const key = s.patient_id ||
        `name:${s.patient_name ?? ""}|doc:${s.clinician_name ?? ""}`
      const list = byPatient.get(key)
      if (list) list.push(s)
      else byPatient.set(key, [s])
    }
    const groups: PatientGroup[] = []
    for (const [key, list] of byPatient) {
      // Newest first within the patient, so the first is the current reading.
      list.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
      const latest = list[0]
      groups.push({
        key,
        patient_id: latest.patient_id,
        name: latest.patient_name || "Anonymous Screening",
        clinician_name: latest.clinician_name,
        clinic_name: latest.clinic_name,
        gender: latest.patient_gender,
        count: list.length,
        latest,
        results: Array.from(
          new Set(list.map(s => s.respiratory_result).filter(Boolean) as string[])
        ),
      })
    }
    // Most recent activity first, so the patient you just screened is at the
    // top of the list.
    groups.sort(
      (a, b) => new Date(b.latest.created_at).getTime() - new Date(a.latest.created_at).getTime()
    )
    return groups
  }, [screenings])

  const filteredAndSortedScreenings = useMemo(() => {
    let result = [...patientGroups]

    if (search) {
      const searchLower = search.toLowerCase()
      result = result.filter(g =>
        g.name.toLowerCase().includes(searchLower) ||
        (g.clinic_name ?? "").toLowerCase().includes(searchLower) ||
        (g.clinician_name ?? "").toLowerCase().includes(searchLower)
      )
    }

    // A patient matches the class filter if ANY of their readings has that
    // result. The count beside their name stays their total, so the row does
    // not change shape depending on the filter.
    if (classFilter !== "all") {
      result = result.filter(g => g.results.includes(classFilter))
    }

    if (genderFilter !== "all") {
      result = result.filter(g => g.gender === genderFilter)
    }

    return result
  }, [patientGroups, search, classFilter, genderFilter])

  /*
   * Row selection drives which PDFs the bulk export writes.
   *
   * The selection is held as screening ids, because that is what the export
   * needs, but the rows are patients. A row is ticked when all of that
   * patient's readings are ticked, and the count shown is the number of
   * readings selected.
   */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())

  /* Every screening belonging to a visible patient. The selection is scoped to
     these, so ids that fall out of view stop counting and are never silently
     exported. */
  const visibleScreenings = useMemo(
    () => filteredAndSortedScreenings.flatMap(g => screeningsByPatient.get(g.patient_id) ?? [g.latest]),
    [filteredAndSortedScreenings, screeningsByPatient]
  )

  const selectedScreenings = useMemo(
    () => visibleScreenings.filter(s => selectedIds.has(s.id)),
    [visibleScreenings, selectedIds]
  )

  const selectedCount = selectedScreenings.length
  const allSelected =
    selectedCount > 0 && selectedCount === visibleScreenings.length

  /* Checked + some-remaining reads as indeterminate, not unchecked. */
  const selectAllRef = useRef<HTMLInputElement>(null)
  const someSelected = selectedCount > 0 && !allSelected
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected
    }
  }, [someSelected])

  /* Selecting a row selects the patient's whole history.

     A row is a patient, so ticking it and exporting one of their readings
     would be a surprise: the export is a handover pack, and it takes a
     patient's complete history. Ticking them takes all of it. */
  const togglePatient = useCallback((group: PatientGroup) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      const ids = (screeningsByPatient.get(group.patient_id) ?? [group.latest]).map(s => s.id)
      const allOn = ids.every(id => next.has(id))
      for (const id of ids) {
        if (allOn) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }, [screeningsByPatient])

  const toggleSelectAll = useCallback(() => {
    setSelectedIds(prev => {
      const next = new Set<string>()
      const everythingPicked =
        visibleScreenings.length > 0 &&
        visibleScreenings.every(s => prev.has(s.id))
      if (!everythingPicked) {
        for (const s of visibleScreenings) next.add(s.id)
      }
      return next
    })
  }, [visibleScreenings])

  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])

  /* Every screening of a patient, grouped by patient.
  /* The export covers whole patients.

     A handover pack is a patient's history, not a scatter of snapshots. So if
     a patient is represented in the export -- by being ticked, or by matching
     the filters -- every one of their screenings goes in with them.

     This is why the count in the toast can be larger than the number of rows
     that were ticked. */
  const exportTargets = useMemo(() => {
    const base = selectedCount > 0 ? selectedScreenings : visibleScreenings
    const seen = new Set<string>()
    const expanded: Screening[] = []
    for (const s of base) {
      const siblings = screeningsByPatient.get(s.patient_id) ?? [s]
      for (const sib of siblings) {
        if (seen.has(sib.id)) continue
        seen.add(sib.id)
        expanded.push(sib)
      }
    }
    return expanded.sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )
  }, [selectedCount, selectedScreenings, visibleScreenings, screeningsByPatient])

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

  /* Deleting a patient removes their screenings with them.

     The database cascades, so the screenings go in one statement, and the
     recordings are cleared off the Mini PC's disk by the same request --
     otherwise every deletion would leave a few megabytes of audio behind and
     the disk would fill up over a year of use. */
  const [deletingPatient, setDeletingPatient] = useState<{
    id: string
    name: string
    count: number
  } | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const confirmDeletePatient = useCallback(async () => {
    if (!deletingPatient) return
    setDeleteBusy(true)
    try {
      const res = await apiFetch(`/api/patients/${deletingPatient.id}`, { method: "DELETE" })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || "Failed to delete patient")
      }
      invalidate("patients")
      invalidate("patient-records")
      invalidate("screenings")
      setSelectedIds(prev => {
        const next = new Set(prev)
        // The rows this patient contributed are gone.
        for (const s of screeningsByPatient.get(deletingPatient.id) ?? []) next.delete(s.id)
        return next
      })
      toast.success(`${deletingPatient.name} deleted`)
      setDeletingPatient(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete patient")
    } finally {
      setDeleteBusy(false)
    }
  }, [deletingPatient, screeningsByPatient])

  /* The 3-dot menu for a row.

     A row is a patient now, not a screening, so the menu acts on the patient.
     "View details" opens their record, which lists every screening they have
     -- that is where the individual readings live, rather than in a submenu
     here, where they were a list of dates with no results in them.

     One shared component, because the table row and the phone card are the
     same menu and were already two copies of it. */
  const ScreeningMenu = ({
    group,
    label,
  }: {
    group: PatientGroup
    label: string
  }) => {
    const screening = group.latest
    return (
      <>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="text-xs font-normal text-aura-muted">
            {label}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => navigate(`/dashboard/patients/${group.patient_id}`)}
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
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => setDeletingPatient({
              id: group.patient_id,
              name: label,
              count: group.count,
            })}
            className="gap-2 text-destructive focus:text-destructive"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Delete patient's records
          </DropdownMenuItem>
        </DropdownMenuContent>
      </>
    )
  }

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
            roleLabel ? (
              /* Only the role.

                 The count that used to be here sat beside it and said
                 "2 screenings of 4" -- and it was counting patients, not
                 screenings, so the number was wrong as well as repeated. The
                 count of what is on screen is in the card below, where it
                 sits next to the list it counts. */
              <span className="rounded-full bg-aura-accent/20 px-3 py-1 text-sm font-bold tracking-wide text-aura-accent">
                {roleLabel}
              </span>
            ) : null
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
                      rather than trailing sentence text.

                      A row is a patient, so the count is of patients, and the
                      wording says so. Saying "records" here would be
                      ambiguous now that one patient can be several records. */}
                  <p className="mt-2 flex items-center gap-2 text-sm text-aura-muted">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-aura-surface-alt px-3 py-1 text-sm font-semibold tabular-nums text-aura-forest">
                      {filteredAndSortedScreenings.length} of {patientGroups.length}
                    </span>
                    <span>patients shown</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void exportAllPDFs()}
                  disabled={exporting || filteredAndSortedScreenings.length === 0}
                  className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-md bg-aura-forest px-5 text-base font-semibold text-white transition-colors hover-tap:bg-aura-forest-light disabled:pointer-events-none disabled:opacity-50"
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
                      className="rounded-md px-1.5 py-1 text-sm font-medium text-aura-muted transition-colors hover-tap:text-aura-forest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-forest"
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
              {filteredAndSortedScreenings.map((group, idx) => {
                const isSelected = selectedIds.has(group.latest.id)
                const label = group.name
                return (
                  <li
                    key={group.key}
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
                          onChange={() => togglePatient(group)}
                          aria-label={`Select ${label} for PDF export`}
                        />
                      </label>

                      <div className="min-w-0 flex-1">
                        <div className="break-words text-base font-medium">{label}</div>
                        {/* How many readings this patient has, and -- for
                            somebody who can see other clinicians' patients --
                            who took them. */}
                        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-sm text-aura-muted">
                          <span className="tabular-nums">
                            {group.count} screening{group.count === 1 ? "" : "s"}
                          </span>
                          {showClinician && group.clinician_name && (
                            <span className="break-words">· {group.clinician_name}</span>
                          )}
                        </div>
                      </div>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="touch-target h-8 w-8 shrink-0 rounded-full text-aura-muted transition-[transform,background-color,color] duration-150 hover-tap:bg-aura-mint-wash hover-tap:text-aura-forest motion-safe:lg:hover:scale-[1.08]"
                            aria-label={`Actions for ${label}`}
                          >
                            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <ScreeningMenu group={group} label={label} />
                      </DropdownMenu>
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
                    {/* How many readings this patient has.

                        The row is the patient, so this is what tells a
                        clinician that there is more than one -- and the
                        patient's record is where the readings themselves
                        are. */}
                    <TableHead className={HEAD_CELL}>
                      Screenings
                    </TableHead>
                    {/* Who took the readings.

                        Only for somebody who can see other clinicians'
                        patients. A clinician sees only the patients they
                        created, so for them this column would be their own
                        name repeated down the page. */}
                    {showClinician && (
                      <TableHead className={HEAD_CELL}>
                        Clinician
                      </TableHead>
                    )}
                    <TableHead className="w-20 text-right font-mono text-[14.5px] font-bold uppercase tracking-[0.08em] text-aura-ink" aria-label="Row actions" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAndSortedScreenings.map((group, idx) => {
                    const isSelected = selectedIds.has(group.latest.id)
                    return (
                    <TableRow
                      key={group.key}
                      className={cn(
                        "group align-middle overflow-hidden border-b border-aura-forest/10 transition-colors duration-150 lg:hover:bg-aura-mint-wash/60 focus-within:bg-aura-mint-wash/60",
                        idx % 2 === 1 && "bg-aura-table-stripe"
                      )}
                    >
                      <TableCell className="w-12 px-2 align-middle">
                        <label className="inline-flex h-11 w-11 cursor-pointer items-center justify-center">
                          <Checkbox
                            className="h-[18px] w-[18px] accent-aura-forest"
                            checked={isSelected}
                            onChange={() => togglePatient(group)}
                            aria-label={`Select ${group.name} for PDF export`}
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
                          className="pointer-events-none absolute inset-y-1.5 left-0 w-[3px] origin-center scale-y-0 rounded-full bg-aura-forest transition-transform duration-150 motion-safe:lg:group-hover:scale-y-100 motion-safe:group-focus-within:scale-y-100"
                        />
                        <div className="break-words text-base font-medium">{group.name}</div>
                      </TableCell>
                      <TableCell className="px-4 align-middle text-base tabular-nums text-aura-muted">
                        {group.count}
                      </TableCell>
                      {showClinician && (
                        <TableCell className="px-4 align-middle">
                          <div className="break-words text-sm text-aura-muted">
                            {group.clinician_name || "—"}
                          </div>
                        </TableCell>
                      )}
                      <TableCell className="px-4 align-middle text-right">
                        <div className="flex items-center justify-end gap-1">
                          {/* View / Download collapse into one trigger so the
                              column stays narrow. */}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="touch-target h-8 w-8 rounded-full text-aura-muted transition-[transform,background-color,color] duration-150 hover-tap:bg-aura-mint-wash hover-tap:text-aura-forest motion-safe:lg:hover:scale-[1.08]"
                                aria-label={`Actions for ${group.name}`}
                              >
                                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            </DropdownMenuTrigger>
                            <ScreeningMenu group={group} label={group.name} />
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            </>
          )}
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>

      {/* Delete confirmation.

          It says what goes with the patient, because "delete patient" and
          "delete the screening" are different things and a clinician who
          wanted to drop one bad reading should not lose the whole history by
          reaching for the wrong button. */}
      <Dialog
        open={Boolean(deletingPatient)}
        onOpenChange={(open) => {
          if (!open && !deleteBusy) setDeletingPatient(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" aria-hidden="true" />
              Delete {deletingPatient?.name}?
            </DialogTitle>
            <DialogDescription className="pt-2">
              This removes the patient record and{" "}
              <span className="font-semibold text-destructive">
                every screening recorded against them
              </span>
              {deletingPatient?.count
                ? ` (${deletingPatient.count} screening${deletingPatient.count === 1 ? "" : "s"})`
                : ""}
              , along with the recordings themselves. It cannot be undone.
              <br />
              To remove a single screening instead, open it and use the delete
              button on that page.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setDeletingPatient(null)}
              disabled={deleteBusy}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmDeletePatient()}
              disabled={deleteBusy}
            >
              {deleteBusy ? "Deleting…" : "Delete patient and all records"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}