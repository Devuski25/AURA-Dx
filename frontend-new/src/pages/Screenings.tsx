"use client"

import { useState, useMemo, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { motion, useReducedMotion } from "framer-motion"
import { Search, ChevronUp, ChevronDown, Download, Eye, AlertTriangle, CheckCircle, Calendar, Stethoscope, FileText, Plus, SearchX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import { cn } from "@/lib/utils"
import { getApiUrl } from "@/lib/api"
import { useCachedData } from "@/hooks/useCachedData"
import { staggerContainer, staggerItem } from "@/lib/motion"
import { getTbBadge, getRespBadge, getResultBadge, getConfidenceColor } from "@/lib/badge-helpers"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { toast } from "sonner"
import { EmptyState } from "@/components/EmptyState"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"

type SortDirection = "asc" | "desc" | null

interface Screening {
  id: string
  patient_id: string
  patient_name: string
  date_of_birth: string
  gender: string
  age_bracket: string
  clinic_name: string
  clinician_name: string
  tb_result: string
  tb_confidence: number | null
  tb_probabilities: Record<string, number> | null
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
  const [search, setSearch] = useState("")
  const [classFilter, setClassFilter] = useState("all")
  const [genderFilter, setGenderFilter] = useState("all")
  const [sortField, setSortField] = useState<SortableField>("created_at")
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc")
  const [detailScreening, setDetailScreening] = useState<Screening | null>(null)

  // Shared cache entry — Dashboard and the Screening wizard read the same key
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

  const { data: screeningsData, isLoading: loading } =
    useCachedData<Screening[]>(user && accessToken ? "screenings" : null, screeningsFetcher)
  const screenings = useMemo(() => screeningsData ?? [], [screeningsData])

  const reduceMotion = useReducedMotion()
  const staggerProps = reduceMotion
    ? {}
    : { variants: staggerContainer, initial: "hidden" as const, animate: "visible" as const }
  const itemProps = reduceMotion ? {} : { variants: staggerItem }

  const handleSort = (field: SortableField) => {
    if (sortField === field) {
      if (sortDirection === "asc") {
        setSortDirection("desc")
      } else if (sortDirection === "desc") {
        setSortDirection(null)
        setSortField("created_at")
      } else {
        setSortDirection("asc")
      }
    } else {
      setSortField(field)
      setSortDirection("asc")
    }
  }

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
      if (classFilter === "Tuberculosis") {
        result = result.filter(s => s.tb_result === "TB")
      } else {
        result = result.filter(s => s.respiratory_result === classFilter)
      }
    }

    if (genderFilter !== "all") {
      result = result.filter(s => s.gender === genderFilter)
    }

    if (sortDirection && sortField) {
      result.sort((a, b) => {
        const aVal = a[sortField]
        const bVal = b[sortField]
        if (aVal === null || aVal === undefined) return 1
        if (bVal === null || bVal === undefined) return -1
        const comparison = String(aVal).localeCompare(String(bVal))
        return sortDirection === "asc" ? comparison : -comparison
      })
    }

    return result
  }, [screenings, search, classFilter, genderFilter, sortField, sortDirection])

  const getStatusBadge = (status: string, reviewedBy: string | null) => {
    if (status === "pending_review") return <Badge variant="warning">Pending Review</Badge>
    if (reviewedBy) return <Badge variant="success">Reviewed</Badge>
    return <Badge variant="secondary">{status}</Badge>
  }

  const SortIcon = ({ field }: { field: SortableField }) => {
    if (sortField !== field) return <span className="text-aura-muted"><ChevronUp className="h-3 w-3" /><ChevronDown className="h-3 w-3" /></span>
    if (sortDirection === "asc") return <ChevronUp className="h-3 w-3" />
    if (sortDirection === "desc") return <ChevronDown className="h-3 w-3" />
    return <span className="text-aura-muted"><ChevronUp className="h-3 w-3" /><ChevronDown className="h-3 w-3" /></span>
  }

  const downloadPDF = async (screeningId: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        toast.error("You must be signed in to download a PDF")
        return
      }
      const response = await fetch(getApiUrl(`/api/screenings/${screeningId}/pdf`), {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!response.ok) {
        toast.error("Failed to download PDF")
        return
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `aura-dx-screening-${screeningId}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error("PDF download failed:", error)
      toast.error("Failed to download PDF")
    }
  }

  return (
    <div className="space-y-6">
      {!embedded && (
        <div>
          <h1 className="font-display text-2xl font-bold text-aura-ink">Screening Records</h1>
          <p className="text-aura-muted">View and manage patient screening records</p>
        </div>
      )}

      <motion.div {...staggerProps}>
        <motion.div {...itemProps}>
          <Card className="overflow-hidden rounded-2xl border border-aura-border-soft bg-white shadow-aura-card transition-shadow duration-300 hover:shadow-aura-card-hover">
            <CardHeader className="border-b border-aura-border-soft px-6 py-5">
              <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
                <div>
                  <CardTitle className="font-display text-lg font-semibold text-aura-ink">All Screenings</CardTitle>
                  <p className="mt-1 text-sm tabular-nums text-aura-muted">
                    Showing {filteredAndSortedScreenings.length} of {screenings.length} records
                  </p>
                </div>
                <Button onClick={() => navigate("/dashboard/screening")} className="h-10 shrink-0 gap-2">
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  New Screening
                </Button>
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
                    className="h-10 pl-9"
                  />
                </div>
                <Select value={classFilter} onValueChange={setClassFilter}>
                  <SelectTrigger className="h-10 w-full md:w-[170px]" aria-label="Filter by result class">
                    <SelectValue placeholder="Class" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="Tuberculosis">Tuberculosis</SelectItem>
                    <SelectItem value="Healthy">Healthy</SelectItem>
                    <SelectItem value="COPD">COPD</SelectItem>
                    <SelectItem value="Pneumonia">Pneumonia</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={genderFilter} onValueChange={setGenderFilter}>
                  <SelectTrigger className="h-10 w-full md:w-[160px]" aria-label="Filter by gender">
                    <SelectValue placeholder="Gender" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="p-0">
          {loading ? (
            <div className="space-y-3 p-6" role="status" aria-live="polite">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between gap-4 rounded-lg border border-aura-border-soft bg-aura-bg-card px-4 py-3">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="h-6 w-20 rounded-full" />
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
            <div className="max-h-[600px] overflow-auto overscroll-contain">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-aura-sage">
                  <TableRow>
                    <TableHead aria-sort={sortField === "patient_name" && sortDirection ? (sortDirection === "asc" ? "ascending" : "descending") : undefined}>
                      <button type="button" onClick={() => handleSort("patient_name")} className="flex items-center gap-1 cursor-pointer select-none">
                        Patient <SortIcon field="patient_name" />
                      </button>
                    </TableHead>
                    <TableHead>Age & Gender</TableHead>
                    <TableHead aria-sort={sortField === "respiratory_result" && sortDirection ? (sortDirection === "asc" ? "ascending" : "descending") : undefined}>
                      <button type="button" onClick={() => handleSort("respiratory_result")} className="flex items-center gap-1 cursor-pointer select-none">
                        Result <SortIcon field="respiratory_result" />
                      </button>
                    </TableHead>
                    <TableHead aria-sort={sortField === "status" && sortDirection ? (sortDirection === "asc" ? "ascending" : "descending") : undefined}>
                      <button type="button" onClick={() => handleSort("status")} className="flex items-center gap-1 cursor-pointer select-none">
                        Status <SortIcon field="status" />
                      </button>
                    </TableHead>
                    <TableHead aria-sort={sortField === "created_at" && sortDirection ? (sortDirection === "asc" ? "ascending" : "descending") : undefined}>
                      <button type="button" onClick={() => handleSort("created_at")} className="flex items-center gap-1 cursor-pointer select-none">
                        Date <SortIcon field="created_at" />
                      </button>
                    </TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAndSortedScreenings.map(screening => (
                    <TableRow key={screening.id} className="hover:bg-aura-surface-alt">
                      <TableCell>
                        <div className="font-medium">{screening.patient_name}</div>
                        <div className="text-xs text-aura-muted">{screening.clinician_name}</div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium tabular-nums">{computeAgeLabel(screening)}</div>
                          <div className="text-xs capitalize text-aura-muted">{screening.gender}</div>
                        </div>
                      </TableCell>
                      <TableCell>{getResultBadge(screening.tb_result, screening.respiratory_result)}</TableCell>
                      <TableCell>{getStatusBadge(screening.status, screening.reviewed_by_name)}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm tabular-nums text-aura-muted">
                        {createdDateFormat.format(new Date(screening.created_at))}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="icon" className="touch-target h-8 w-8 rounded-full text-aura-muted hover:text-aura-ink" onClick={() => setDetailScreening(screening)} aria-label={`View details for ${screening.patient_name}`}>
                                <Eye className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>View details</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="icon" className="touch-target h-8 w-8 rounded-full text-aura-muted hover:text-aura-ink" onClick={() => downloadPDF(screening.id)} aria-label={`Download PDF for ${screening.patient_name}`}>
                                <Download className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Download PDF</TooltipContent>
                          </Tooltip>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>

      {/* Detail Dialog */}
      <Dialog open={!!detailScreening} onOpenChange={open => !open && setDetailScreening(null)}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto overscroll-contain">
          {detailScreening && (
            <DialogHeader>
              <DialogTitle>Screening Details - {detailScreening.patient_name}</DialogTitle>
              <DialogDescription>Screening ID: {detailScreening.id}</DialogDescription>
            </DialogHeader>
          )}
          {detailScreening && (
            <div className="space-y-6 py-4">
              {/* Patient Info */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Patient Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-4">
                  <div>
                    <p className="text-sm text-aura-muted">Name</p>
                    <p className="font-medium">{detailScreening.patient_name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-aura-muted">Age / Gender</p>
                    <p className="font-medium">
                      {detailScreening.age_bracket} • {detailScreening.gender}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-aura-muted">Clinic / Clinician</p>
                    <p className="font-medium">{detailScreening.clinic_name} / {detailScreening.clinician_name}</p>
                  </div>
                </CardContent>
              </Card>

              {/* Screening Metadata */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="h-5 w-5" />
                    Screening Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-4">
                  <div>
                    <p className="text-sm text-aura-muted">Date</p>
                    <p className="font-medium tabular-nums">{dateTimeFormat.format(new Date(detailScreening.created_at))}</p>
                  </div>
                  <div>
                    <p className="text-sm text-aura-muted">Model Version</p>
                    <p className="font-medium font-mono">{detailScreening.model_version}</p>
                  </div>
                  <div>
                    <p className="text-sm text-aura-muted">Cascade Path</p>
                    <p className="font-medium">{detailScreening.cascade_path}</p>
                  </div>
                  <div>
                    <p className="text-sm text-aura-muted">Audio Duration</p>
                    <p className="font-medium tabular-nums">{detailScreening.audio_duration_sec ? `${detailScreening.audio_duration_sec}s` : "N/A"}</p>
                  </div>
                </CardContent>
              </Card>

              <Separator />

              {/* Tier 1: TB Gatekeeper */}
              <Card className="border-l-4 border-l-destructive/50">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-destructive" />
                      Tier 1: TB Gatekeeper
                    </CardTitle>
                    {getTbBadge(detailScreening.tb_result)}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="p-4 bg-aura-surface-alt rounded-lg">
                      <p className="text-sm text-aura-muted">Confidence</p>
                      <p className={cn("font-mono text-3xl font-bold tabular-nums", getConfidenceColor(detailScreening.tb_confidence))}>
                        {(detailScreening.tb_confidence ? detailScreening.tb_confidence * 100 : 0).toFixed(1)}%
                      </p>
                    </div>
                    <div className="p-4 bg-aura-surface-alt rounded-lg">
                      <p className="text-sm text-aura-muted">Model Version</p>
                      <p className="font-mono">{detailScreening.model_version}</p>
                    </div>
                    <div className="p-4 bg-aura-surface-alt rounded-lg">
                      <p className="text-sm text-aura-muted">Cascade</p>
                      <p className="font-medium">{detailScreening.cascade_path.includes("Tier 2") ? "Continued to Tier 2" : "Stopped at Tier 1"}</p>
                    </div>
                  </div>

                  {detailScreening.tb_probabilities && (
                    <div>
                      <p className="text-sm text-aura-muted mb-2">Probability Distribution</p>
                      <div className="space-y-3">
                        {Object.entries(detailScreening.tb_probabilities).map(([cls, prob]) => (
                          <div key={cls} className="space-y-1">
                            <div className="flex justify-between text-sm">
                              <span className={cn("font-medium", cls === "TB" ? "text-destructive" : "text-aura-accent-dark")}>{cls}</span>
                              <span className="font-mono">{(prob * 100).toFixed(1)}%</span>
                            </div>
                            <Progress value={prob * 100} className="h-2" />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {detailScreening.tb_result === "TB" && (
                    <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
                      <h4 className="font-semibold text-destructive flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5" />
                        High Priority: TB Detected
                      </h4>
                      <p className="mt-2 text-sm">Immediate referral for confirmatory TB testing recommended. Follow local TB protocols.</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Tier 2: Respiratory Classifier */}
              {detailScreening.respiratory_result && (
                <Card className="border-l-4 border-l-aura-accent/50">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2">
                        <Stethoscope className="h-5 w-5 text-aura-accent" />
                        Tier 2: Respiratory Classifier
                      </CardTitle>
                      {getRespBadge(detailScreening.respiratory_result)}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="p-4 bg-aura-surface-alt rounded-lg">
                        <p className="text-sm text-aura-muted">Confidence</p>
                        <p className={cn("font-mono text-3xl font-bold tabular-nums", getConfidenceColor(detailScreening.respiratory_confidence))}>
                          {(detailScreening.respiratory_confidence ? detailScreening.respiratory_confidence * 100 : 0).toFixed(1)}%
                        </p>
                      </div>
                    </div>

                    {detailScreening.respiratory_probabilities && (
                      <div>
                        <p className="text-sm text-aura-muted mb-2">Probability Distribution</p>
                        <div className="space-y-3">
                          {Object.entries(detailScreening.respiratory_probabilities).map(([cls, prob]) => (
                            <div key={cls} className="space-y-1">
                              <div className="flex justify-between text-sm">
                                <span className={cn("font-medium", cls === "Pneumonia" ? "text-destructive" : cls === "COPD" ? "text-aura-warning" : "text-aura-accent-dark")}>{cls}</span>
                                <span className="font-mono">{(prob * 100).toFixed(1)}%</span>
                              </div>
                              <Progress value={prob * 100} className="h-2" />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {detailScreening.respiratory_result === "Pneumonia" && (
                      <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
                        <h4 className="font-semibold text-destructive flex items-center gap-2">
                          <AlertTriangle className="h-5 w-5" />
                          High Priority: Pneumonia Suspected
                        </h4>
                        <p className="mt-2 text-sm">Urgent clinical evaluation recommended. Consider chest imaging and antibiotics per guidelines.</p>
                      </div>
                    )}

                    {detailScreening.respiratory_result === "COPD" && (
                      <div className="p-4 bg-aura-warning-soft border border-aura-warning-border rounded-lg">
                        <h4 className="font-semibold text-aura-warning-strong flex items-center gap-2">
                          <AlertTriangle className="h-5 w-5" />
                          Moderate Priority: COPD Suspected
                        </h4>
                        <p className="mt-2 text-sm">Clinical evaluation recommended. Consider spirometry and pulmonology referral.</p>
                      </div>
                    )}

                    {detailScreening.respiratory_result === "Healthy" && (
                      <div className="p-4 bg-aura-accent-soft border border-aura-border rounded-lg">
                        <h4 className="flex items-center gap-2 font-semibold text-aura-accent-dark">
                          <CheckCircle className="h-5 w-5" />
                          Low Priority: No Acute Findings
                        </h4>
                        <p className="mt-2 text-sm">No urgent action required. Routine follow-up as clinically indicated.</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Review Status */}
              <Card>
                <CardHeader>
                  <CardTitle>Review Status</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-3">
                  <div>
                    <p className="text-sm text-aura-muted">Status</p>
                    {getStatusBadge(detailScreening.status, detailScreening.reviewed_by_name)}
                  </div>
                  <div>
                    <p className="text-sm text-aura-muted">Reviewed By</p>
                    <p className="font-medium">{detailScreening.reviewed_by_name || "Not yet reviewed"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-aura-muted">Review Date</p>
                    <p className="font-medium tabular-nums">{detailScreening.reviewed_at ? dateTimeFormat.format(new Date(detailScreening.reviewed_at)) : "—"}</p>
                  </div>
                  {detailScreening.review_notes && (
                    <div className="md:col-span-3">
                      <p className="text-sm text-aura-muted">Review Notes</p>
                      <p className="font-medium">{detailScreening.review_notes}</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <DialogFooter>
                <Button variant="outline" onClick={() => downloadPDF(detailScreening.id)}>
                  <Download className="mr-2 h-4 w-4" />
                  Download PDF
                </Button>
                <Button variant="outline" onClick={() => setDetailScreening(null)}>
                  Close
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
