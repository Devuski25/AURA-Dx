"use client"

import { useEffect, useMemo, useState, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { motion, useReducedMotion } from "framer-motion"
import { Loader2, Search, Edit, Trash2, Users, XCircle, FileDown, Eye } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { supabase } from "@/lib/supabase"
import { getApiUrl } from "@/lib/api"
import { useAuth } from "@/hooks/useAuth"
import { Skeleton } from "@/components/ui/skeleton"
import { useCachedData } from "@/hooks/useCachedData"
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
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  FormDescription,
} from "@/components/ui/form"
import { getResultBadge } from "@/lib/badge-helpers"
import { cn } from "@/lib/utils"
import { staggerContainer, staggerItem } from "@/lib/motion"
import { z } from "zod"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"

const patientSchema = z.object({
  full_name: z.string().min(2, "Name must be at least 2 characters"),
  date_of_birth: z.string().min(1, "Date of birth is required"),
  gender: z.enum(["male", "female", "other"]),
  smoking_history: z.boolean(),
  pack_years: z.coerce.number().nullable().optional(),
  past_respiratory_diseases: z.array(z.string()),
  symptoms: z.array(z.string()),
})

// Disease type is derived from the latest screening result.
// TB takes priority (matches getResultBadge); otherwise the respiratory result.
export const DISEASE_FILTERS = ["Healthy", "COPD", "Pneumonia", "TB"] as const
export type DiseaseFilter = (typeof DISEASE_FILTERS)[number]

export function getPatientDisease(patient: any): string | null {
  const ls = patient?.latest_screening
  if (!ls) return null
  if (ls.tb_result === "TB") return "TB"
  if (ls.respiratory_result) return ls.respiratory_result
  return null
}

function computeAge(dateOfBirth: string): number | null {
  if (!dateOfBirth) return null
  const dob = new Date(dateOfBirth)
  if (isNaN(dob.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - dob.getFullYear()
  const monthDiff = today.getMonth() - dob.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--
  }
  return age
}

type PatientFormData = z.infer<typeof patientSchema>

const createdDateFormat = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" })

function getInitials(name: string) {
  const parts = name.trim().split(" ")
  const first = parts[0]?.charAt(0) || ""
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : ""
  return `${first}${last}`.toUpperCase()
}

const AVATAR_COLORS = [
  "bg-[#E3F5EC] text-aura-pine",
  "bg-[#FCEAE6] text-aura-coral-strong",
  "bg-[#FEF3C7] text-[#B45309]",
  "bg-[#EAF1EC] text-[#155E54]",
  "bg-[#D7EEE3] text-[#0E5A42]",
  "bg-[#F5EBDD] text-[#8A5A2B]",
]

function getAvatarColor(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

function getConditionClass(condition: string) {
  if (condition === "TB" || condition === "Pneumonia") {
    return "border-transparent bg-aura-coral-soft text-aura-coral-strong"
  }

  if (condition === "COPD") {
    return "border-transparent bg-aura-warning-soft text-aura-warning-strong"
  }

  return "border-transparent bg-aura-sage text-aura-forest"
}

export function Patients({ embedded = false }: { embedded?: boolean }) {
  const { user, accessToken } = useAuth()
  const navigate = useNavigate()
  const [search, setSearch] = useState("")
  const [genderFilter, setGenderFilter] = useState("all")
  const [diseaseFilter, setDiseaseFilter] = useState("all")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingPatient, setEditingPatient] = useState<any | null>(null)
  const [deletingPatient, setDeletingPatient] = useState<any | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const rowsPerPage = 5

  const reduceMotion = useReducedMotion()
  const staggerProps = reduceMotion
    ? {}
    : { variants: staggerContainer, initial: "hidden" as const, animate: "visible" as const }
  const itemProps = reduceMotion ? {} : { variants: staggerItem }

  const form = useForm<PatientFormData>({
    resolver: zodResolver(patientSchema),
    defaultValues: {
      full_name: "",
      date_of_birth: "",
      gender: "male",
      smoking_history: false,
      pack_years: undefined,
      past_respiratory_diseases: [],
      symptoms: [],
    },
  })

  const recordsFetcher = useCallback(async (): Promise<any[]> => {
    let query = supabase
      .from("patient_list_view")
      .select("*")

    if (user?.role === "admin" && user.clinic_id) {
      query = query.eq("clinic_id", user.clinic_id)
    }
    // super_admin sees all clinics — no filter needed

    const { data: patientsData, error: patientsError } = await query.order("created_at", { ascending: false })
    if (patientsError) throw patientsError

    const { data: allScreenings } = await supabase
      .from("screening_history_view")
      .select("patient_id, tb_result, respiratory_result, created_at")
      .order("created_at", { ascending: false })

    const latestScreenings: Record<string, any> = {}
    if (allScreenings) {
      for (const s of allScreenings) {
        if (!latestScreenings[s.patient_id]) {
          latestScreenings[s.patient_id] = s
        }
      }
    }

    return (patientsData || []).map(p => ({
      ...p,
      latest_screening: latestScreenings[p.id] || null,
    }))
  }, [user])

  const { data: recordsData, isLoading: loading, refresh } = useCachedData<any[]>(
    user ? "patient-records" : null,
    recordsFetcher,
    { ttlMs: 60_000 },
  )
  const patients = useMemo(() => recordsData ?? [], [recordsData])

  const handleSubmit = async (data: PatientFormData) => {
    try {
      if (editingPatient) {
        const res = await fetch(getApiUrl(`/api/patients/${editingPatient.id}`), {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken ?? ""}`,
          },
          body: JSON.stringify({
            full_name: data.full_name,
            date_of_birth: data.date_of_birth,
            gender: data.gender,
            smoking_history: data.smoking_history,
            pack_years: data.pack_years ?? null,
            past_respiratory_diseases: data.past_respiratory_diseases,
            symptoms: data.symptoms,
          }),
        })
        if (!res.ok) {
          const detail = await res.json().catch(() => ({}))
          throw new Error(detail.detail || "Failed to update patient")
        }
      } else {
        const { error } = await supabase
          .from("patients")
          .insert({
            ...data,
            clinician_id: user?.id,
            clinic_id: user?.clinic_id,
          })
        if (error) throw error
      }
      void refresh()
      setDialogOpen(false)
      form.reset()
    } catch (error) {
      console.error("Error saving patient:", error)
      toast.error("Failed to save patient")
    }
  }

  const handleDelete = async () => {
    if (!deletingPatient) return
    setDeleting(true)
    try {
      const res = await fetch(getApiUrl(`/api/patients/${deletingPatient.id}`), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken ?? ""}` },
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.detail || "Failed to delete patient")
      }
      void refresh()
    } catch (error) {
      console.error("Error deleting patient:", error)
      toast.error("Failed to delete patient")
    } finally {
      setDeleting(false)
      setDeleteConfirmOpen(false)
      setDeletingPatient(null)
    }
  }

  useEffect(() => {
    setCurrentPage(1)
  }, [search, genderFilter, diseaseFilter])

  const filteredPatients = patients
    .filter(p => {
      if (search) {
        const searchLower = search.toLowerCase()
        return p.full_name.toLowerCase().includes(searchLower)
      }
      return true
    })
    .filter(p => {
      if (genderFilter === "all") return true
      return p.gender === genderFilter
    })
    .filter(p => {
      if (diseaseFilter === "all") return true
      return getPatientDisease(p) === diseaseFilter
    })

  const totalPages = Math.max(1, Math.ceil(filteredPatients.length / rowsPerPage))
  const firstRowIndex = (currentPage - 1) * rowsPerPage
  const visiblePatients = filteredPatients.slice(firstRowIndex, firstRowIndex + rowsPerPage)

  const openEditDialog = (patient: any) => {
    setEditingPatient(patient)
    form.reset({
      full_name: patient.full_name,
      date_of_birth: patient.date_of_birth,
      gender: patient.gender,
      smoking_history: patient.smoking_history || false,
      pack_years: patient.pack_years ?? undefined,
      past_respiratory_diseases: patient.past_respiratory_diseases || [],
      symptoms: patient.symptoms || [],
    })
    setDialogOpen(true)
  }

  const confirmDelete = (patient: any) => {
    setDeletingPatient(patient)
    setDeleteConfirmOpen(true)
  }

  const handleExportPdf = useCallback(() => {
    if (filteredPatients.length === 0) {
      toast.error("No patients to export")
      return
    }
    const escapeHtml = (value: string) =>
      value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string))
    const resultText = (p: any) => {
      const ls = p.latest_screening
      if (!ls) return "N/A"
      if (ls.tb_result === "TB") return "TB"
      if (ls.respiratory_result) return ls.respiratory_result
      return "N/A"
    }
    const dateStr = new Date().toISOString().slice(0, 10)
    const fileName = `AURA-Dx_Patient_Report_${dateStr}`
    const rows = filteredPatients.map(p => {
      const smoking = p.smoking_history
        ? (p.pack_years ? `${p.pack_years} pack-years` : "Yes")
        : "Non-smoker"
      const conditions = (p.past_respiratory_diseases || []).length
        ? (p.past_respiratory_diseases as string[]).join(", ")
        : "—"
      return `<tr>
        <td>${escapeHtml(p.full_name)}</td>
        <td>${escapeHtml(p.age_bracket || "—")}</td>
        <td>${escapeHtml(p.gender)}</td>
        <td>${escapeHtml(smoking)}</td>
        <td>${escapeHtml(conditions)}</td>
        <td>${escapeHtml(resultText(p))}</td>
        <td>${escapeHtml(p.created_at ? createdDateFormat.format(new Date(p.created_at)) : "—")}</td>
      </tr>`
    }).join("")
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${fileName}</title>
      <style>
        body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #0f172a; padding: 24px; }
        h1 { font-size: 18px; color: #0a352e; margin: 0 0 4px; }
        p.sub { color: #64748b; margin: 0 0 16px; font-size: 12px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th { text-align: left; background: #f1f5f4; color: #155e54; padding: 8px; border-bottom: 2px solid #0a352e; text-transform: uppercase; letter-spacing: 0.05em; font-size: 10px; }
        td { padding: 8px; border-bottom: 1px solid #e2e8f0; }
        @media print { body { padding: 0; } }
      </style></head>
      <body>
        <h1>AURA-Dx — Patient Report</h1>
        <p class="sub">Generated ${new Date().toLocaleString()} · ${filteredPatients.length} patient(s)</p>
        <table>
          <thead><tr>
            <th>Name</th><th>Age</th><th>Gender</th><th>Smoking</th><th>Conditions</th><th>Latest Result</th><th>Created</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </body></html>`
    const printWindow = window.open("", "_blank")
    if (!printWindow) {
      toast.error("Pop-up blocked. Allow pop-ups to export the PDF.")
      return
    }
    printWindow.document.open()
    printWindow.document.write(html)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
  }, [filteredPatients])

  return (
    <div className="space-y-6">
      {!embedded && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold text-aura-ink">Patients</h1>
            <p className="text-aura-muted">Manage patient records and screenings</p>
          </div>
        </div>
      )}

      <motion.div {...staggerProps}>
        <motion.div {...itemProps}>
          <Card className="overflow-hidden rounded-2xl border border-aura-border-soft bg-white shadow-aura-card transition-shadow duration-300 hover:shadow-aura-card-hover">
            <CardHeader className="border-b border-aura-border-soft px-6 py-5">
              <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
                <div>
                  <CardTitle className="font-display text-lg font-semibold text-aura-ink">Patient Records</CardTitle>
                  <p className="mt-1 text-sm tabular-nums text-aura-muted">
                    Showing {filteredPatients.length} of {patients.length} records
                  </p>
                </div>
                <Button onClick={handleExportPdf} className="h-10 shrink-0 gap-2" disabled={filteredPatients.length === 0}>
                  <FileDown className="h-4 w-4" />
                  <span>Export PDF</span>
                </Button>
              </div>
              <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
                <div className="relative max-w-xs flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-aura-muted" aria-hidden="true" />
                  <Input
                    type="search"
                    placeholder="Search patients by name…"
                    aria-label="Search patients by name"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="h-10 pr-9 pl-9 transition-shadow focus-visible:ring-2 focus-visible:ring-aura-brand"
                  />
                  {search && (
                    <button type="button" onClick={() => setSearch("")} aria-label="Clear search" className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-aura-muted transition-colors hover:bg-aura-surface-alt hover:text-aura-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-brand">
                      <XCircle className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
                <Select value={genderFilter} onValueChange={setGenderFilter}>
                  <SelectTrigger className="h-10 w-full md:w-[160px]" aria-label="Filter by gender">
                    <SelectValue placeholder="Gender" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Gender</SelectItem>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={diseaseFilter} onValueChange={setDiseaseFilter}>
                  <SelectTrigger className="h-10 w-full md:w-[170px]" aria-label="Filter by condition">
                    <SelectValue placeholder="Disease" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Diseases</SelectItem>
                    {DISEASE_FILTERS.map(d => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="p-0">
          {loading ? (
            <div role="status" aria-live="polite" aria-label="Loading patients">
              {/* Header skeleton */}
              <div className="border-b border-aura-border-soft px-6 py-4">
                <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-3.5 w-56" />
                  </div>
                  <Skeleton className="h-10 w-28 rounded-md" />
                </div>
              </div>
              {/* Table rows skeleton */}
              <div className="divide-y divide-aura-border-soft">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                    <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-36" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                    <Skeleton className="hidden h-4 w-14 sm:block" />
                    <Skeleton className="hidden h-5 w-16 rounded-full sm:block" />
                    <Skeleton className="hidden h-5 w-16 rounded-full md:block" />
                    <div className="ml-auto flex gap-1.5">
                      <Skeleton className="h-8 w-8 rounded-full" />
                      <Skeleton className="h-8 w-8 rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : filteredPatients.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No Patients Found"
              hint="Try adjusting your search or filters"
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-aura-sage">
                  <TableRow className="align-middle border-b border-aura-border-soft hover:bg-transparent">
                    <TableHead className="px-4 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-aura-muted">Name</TableHead>
                    <TableHead className="px-4 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-aura-muted">Age &amp; Gender</TableHead>
                    <TableHead className="px-4 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-aura-muted">Smoking</TableHead>
                    <TableHead className="px-4 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-aura-muted">Conditions</TableHead>
                    <TableHead className="px-4 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-aura-muted">Latest Result</TableHead>
                    <TableHead className="px-4 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-aura-muted">Created</TableHead>
                    <TableHead className="w-32 px-4 text-right font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-aura-muted">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visiblePatients.map(patient => (
                    <motion.tr key={patient.id} {...(reduceMotion ? {} : itemProps)} className="align-middle border-b border-aura-border-soft transition-colors hover:bg-aura-surface-alt">
                      <TableCell className="px-4 align-middle">
                        <div className="flex items-center gap-3">
                          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${getAvatarColor(patient.full_name)}`}>
                            {getInitials(patient.full_name)}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate font-medium">{patient.full_name}</div>
                            <div className="truncate text-xs text-aura-muted">{patient.clinician_name}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="px-4 align-middle">
                        <div>
                          <div className="font-medium tabular-nums">{patient.age_bracket}</div>
                          <div className="text-xs capitalize text-aura-muted">{patient.gender}</div>
                        </div>
                      </TableCell>
                      <TableCell className="px-4 align-middle">
                        {patient.smoking_history ? (
                          <Badge variant="secondary">
                            {patient.pack_years ? `${patient.pack_years} pack-years` : "Yes"}
                          </Badge>
                        ) : (
                          <Badge variant="outline">Non-smoker</Badge>
                        )}
                      </TableCell>
                      <TableCell className="px-4 align-middle">
                        {(patient.past_respiratory_diseases || []).length === 0 ? (
                          <span className="text-sm text-aura-muted">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {(patient.past_respiratory_diseases || []).slice(0, 2).map((d: string, i: number) => (
                              <Badge key={i} variant="outline" className={getConditionClass(d)}>{d}</Badge>
                            ))}
                            {(patient.past_respiratory_diseases || []).length > 2 && (
                              <Badge variant="outline" className="border-transparent bg-aura-sage text-aura-forest">+{(patient.past_respiratory_diseases || []).length - 2} more</Badge>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="px-4 align-middle">
                        {getResultBadge(
                          patient.latest_screening?.tb_result || null,
                          patient.latest_screening?.respiratory_result || null
                        )}
                      </TableCell>
                      <TableCell className="px-4 align-middle">
                        <span className="whitespace-nowrap text-sm tabular-nums text-aura-muted">
                          {patient.created_at ? createdDateFormat.format(new Date(patient.created_at)) : "—"}
                        </span>
                      </TableCell>
                      <TableCell className="w-32 px-4 text-right align-middle">
                        <div className="flex items-center justify-end gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="touch-target h-8 w-8 rounded-full text-aura-muted transition-colors hover:bg-aura-sage hover:text-aura-forest"
                                onClick={() => {
                                  const latest = patient.latest_screening
                                  if (latest?.id) {
                                    navigate(`/dashboard/screenings/${latest.id}`)
                                  } else {
                                    navigate(`/dashboard/patients/${patient.id}`)
                                  }
                                }}
                                aria-label={`View ${patient.full_name}`}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>View details</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="touch-target h-8 w-8 rounded-full text-aura-muted transition-colors hover:bg-aura-sage hover:text-aura-forest"
                                onClick={() => openEditDialog(patient)}
                                aria-label={`Edit ${patient.full_name}`}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Edit patient</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="touch-target h-8 w-8 rounded-full text-destructive transition-colors hover:bg-aura-coral-soft"
                                onClick={() => confirmDelete(patient)}
                                aria-label={`Delete ${patient.full_name}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Delete patient</TooltipContent>
                          </Tooltip>
                        </div>
                      </TableCell>
                  </motion.tr>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {filteredPatients.length > 0 && (
            <div className="flex items-center justify-between border-t border-aura-border-soft px-4 py-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(currentPage - 1)}
                disabled={currentPage === 1}
                className="border-aura-border text-aura-forest hover:bg-aura-sage hover:text-aura-forest"
              >
                Previous
              </Button>
              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    aria-label={`Go to page ${page}`}
                    aria-current={page === currentPage ? "page" : undefined}
                    className={cn(
                      "flex h-9 min-w-9 items-center justify-center rounded-md px-2 text-sm font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-brand",
                      page === currentPage
                        ? "bg-primary text-primary-foreground"
                        : "text-aura-forest hover:bg-aura-sage"
                    )}
                  >
                    {page}
                  </button>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="border-aura-border text-aura-forest hover:bg-aura-sage hover:text-aura-forest"
              >
                Next
              </Button>
            </div>
          )}
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>

      {/* Add/Edit Patient Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingPatient ? "Edit Patient" : "Add New Patient"}</DialogTitle>
            <DialogDescription>
              {editingPatient ? "Update patient information" : "Create a new patient record"}
            </DialogDescription>
          </DialogHeader>
          <Form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="full_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Full Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Dr. John Smith" autoComplete="name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="date_of_birth"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date of Birth</FormLabel>
                      <FormControl>
                        <Input type="date" autoComplete="bday" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {editingPatient && (
                <div className="flex items-center gap-2 rounded-lg bg-aura-surface-alt px-4 py-3">
                  <span className="text-sm text-aura-muted">Age</span>
                  <span className="text-lg font-semibold text-aura-text">
                    {computeAge(form.watch("date_of_birth")) ?? "—"} years old
                  </span>
                </div>
              )}

              {!editingPatient && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="gender"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Gender</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select gender" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="male">Male</SelectItem>
                              <SelectItem value="female">Female</SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="pack_years"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Pack Years (if smoker)</FormLabel>
                          <FormControl>
                            <Input type="number" step="0.1" placeholder="e.g., 20" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="smoking_history"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Smoking History</FormLabel>
                        <FormControl>
                          <div className="flex gap-6 pt-1">
                            <label className="flex cursor-pointer items-center gap-2">
                              <input
                                type="radio"
                                checked={field.value === true}
                                onChange={() => field.onChange(true)}
                                className="h-4 w-4"
                              />
                              <span className="text-sm">Yes</span>
                            </label>
                            <label className="flex cursor-pointer items-center gap-2">
                              <input
                                type="radio"
                                checked={field.value === false}
                                onChange={() => field.onChange(false)}
                                className="h-4 w-4"
                              />
                              <span className="text-sm">No</span>
                            </label>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="past_respiratory_diseases"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Past Respiratory Diseases (comma separated)</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Asthma, COPD, Bronchitis"
                            value={field.value.join(", ")}
                            onChange={e => field.onChange(e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
                          />
                        </FormControl>
                        <FormDescription>Separate with commas</FormDescription>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="symptoms"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Current Symptoms (comma separated)</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Cough, Fever, Shortness of breath"
                            value={field.value.join(", ")}
                            onChange={e => field.onChange(e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
                          />
                        </FormControl>
                        <FormDescription>Separate with commas</FormDescription>
                      </FormItem>
                    )}
                  />
                </>
              )}

            <DialogFooter>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Saving…" : editingPatient ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Patient</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {deletingPatient?.full_name}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              <Loader2 className={`mr-2 h-4 w-4 ${deleting ? "animate-spin" : "hidden"}`} role="status" aria-live="polite" />
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
