"use client"

import { useEffect, useState } from "react"
import { Link, useParams, useNavigate } from "react-router-dom"
import { ArrowLeft, Trash2, Calendar, Shield, FileText, AlertTriangle, RefreshCw } from "lucide-react"
import { motion } from "framer-motion"
import { cardHover } from "@/lib/motion"
import { Button, buttonVariants } from "@/components/ui/button"
import { EmptyState } from "@/components/EmptyState"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { invalidate } from "@/hooks/useCachedData"
import { useAuth } from "@/hooks/useAuth"
import { apiFetch } from "@/lib/api"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { ConfidenceChip, ScreeningStatusBadge } from "@/lib/badge-helpers"

interface Patient {
  id: string
  full_name: string
  date_of_birth: string
  gender: string
  smoking_history: boolean
  pack_years: number | null
  past_respiratory_diseases: string[]
  symptoms: string[]
  clinic_name: string
  clinician_name: string
  created_at: string
  age_bracket: string
}

interface Screening {
  id: string
  respiratory_result: string | null
  respiratory_confidence: number | null
  model_version: string
  status: string
  reviewed_by_name: string | null
  reviewed_at: string | null
  review_notes: string | null
  created_at: string
  // Which screening this is for the patient, and how many they have.
  screening_number: number | null
  patient_screening_count: number | null
}

export function PatientDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { accessToken } = useAuth()
  const [patient, setPatient] = useState<Patient | null>(null)
  const [screenings, setScreenings] = useState<Screening[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)

  useEffect(() => {
    if (id) {
      const loadAll = async () => {
        setLoading(true)
        setError(null)
        try {
          const [patientRes, screeningsRes] = await Promise.all([
            apiFetch(`/api/patients/${id}`),
            apiFetch(`/api/screenings?patient_id=${id}`),
          ])
          if (!patientRes.ok) {
            const err = await patientRes.json().catch(() => ({}))
            throw new Error(err.detail || "Patient not found")
          }
          if (!screeningsRes.ok) {
            const err = await screeningsRes.json().catch(() => ({}))
            throw new Error(err.detail || "Failed to load screenings")
          }
          const [patientData, screeningsData] = await Promise.all([patientRes.json(), screeningsRes.json()])
          setPatient(patientData)
          setScreenings(screeningsData || [])
        } catch (error) {
          console.error("Error fetching patient:", error)
          setError(error instanceof Error ? error.message : "Failed to load patient")
        } finally {
          setLoading(false)
        }
      }
      loadAll()
    }
  }, [id, accessToken])

  const handleRetry = () => {
    if (id) {
      const loadAll = async () => {
        setLoading(true)
        setError(null)
        try {
          const [patientRes, screeningsRes] = await Promise.all([
            apiFetch(`/api/patients/${id}`),
            apiFetch(`/api/screenings?patient_id=${id}`),
          ])
          if (!patientRes.ok) {
            const err = await patientRes.json().catch(() => ({}))
            throw new Error(err.detail || "Patient not found")
          }
          if (!screeningsRes.ok) {
            const err = await screeningsRes.json().catch(() => ({}))
            throw new Error(err.detail || "Failed to load screenings")
          }
          const [patientData, screeningsData] = await Promise.all([patientRes.json(), screeningsRes.json()])
          setPatient(patientData)
          setScreenings(screeningsData || [])
        } catch (error) {
          console.error("Error fetching patient:", error)
          setError(error instanceof Error ? error.message : "Failed to load patient")
        } finally {
          setLoading(false)
        }
      }
      loadAll()
    }
  }

  const handleDelete = async () => {
    if (!id) return
    setDeleting(true)
    try {
      const res = await apiFetch(`/api/patients/${id}`, { method: "DELETE" })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.detail || "Failed to delete patient")
      }
      // Deleted - drop cached lists so Patients/Screenings refetch fresh
      invalidate("patient-records")
      invalidate("screenings")
      navigate("/dashboard/patient-records")
    } catch (error) {
      console.error("Error deleting patient:", error)
      toast.error("Failed to delete patient")
    } finally {
      setDeleting(false)
      setDeleteConfirmOpen(false)
    }
  }

  

  const getRespBadge = (result: string | null) => {
    if (!result) return <Badge variant="secondary">N/A</Badge>
    const variants: Record<string, "default" | "success" | "warning" | "destructive"> = {
      Healthy: "success",
      Pneumonia: "destructive",
      COPD: "warning",
    }
    return <Badge variant={variants[result] || "default"}>{result}</Badge>
  }

  const getStatusBadge = (status: string, reviewedBy: string | null) => (
    <ScreeningStatusBadge status={status} reviewedBy={reviewedBy} />
  )

  if (loading) {
    return (
      <div className="space-y-6" role="status" aria-live="polite">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="grid gap-8 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            /* White panels with the same top edge as the real cards, so the
               loading state doesn't read as a different page. */
            <div key={i} className="aura-panel aura-panel-edge h-28 rounded-2xl bg-white">
              <Skeleton className="h-full w-full rounded-2xl bg-aura-surface-alt/50" />
            </div>
          ))}
        </div>
        <div className="grid gap-8 md:grid-cols-2 lg:gap-6">
          <div className="aura-panel aura-panel-edge h-40 rounded-2xl bg-white">
            <Skeleton className="h-full w-full rounded-2xl bg-aura-surface-alt/50" />
          </div>
          <div className="aura-panel aura-panel-edge h-40 rounded-2xl bg-white">
            <Skeleton className="h-full w-full rounded-2xl bg-aura-surface-alt/50" />
          </div>
        </div>
        <div className="aura-panel aura-panel-edge h-64 rounded-2xl bg-white">
          <Skeleton className="h-full w-full rounded-2xl bg-aura-surface-alt/50" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 text-center h-[50vh]" role="alert">
        <AlertTriangle className="h-12 w-12 text-destructive" />
        <div>
          <p className="text-lg font-medium text-aura-text">Could not load patient</p>
          <p className="text-aura-muted">{error}</p>
        </div>
        <Button variant="outline" onClick={handleRetry} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Retry
        </Button>
      </div>
    )
  }

  if (!patient) {
    return (
      <div className="text-center py-8">
        <p className="text-aura-muted">Patient not found</p>
        <Button variant="outline" onClick={() => navigate("/dashboard/patient-records")} className="mt-4">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Patient Records
        </Button>
      </div>
    )
  }

  const age = (() => {
      const today = new Date()
      const birthDate = new Date(patient.date_of_birth)
      let age = today.getFullYear() - birthDate.getFullYear()
      const monthDiff = today.getMonth() - birthDate.getMonth()
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--
      }
      return age
    })()

  return (
    <div className="space-y-6">
      {/* Header — one back action, app-wide pattern (B6)

          The name is below the back button on every width.

          They used to share a line from the tablet width up, and a small back
          button next to a large name is a bad pairing: the name was crowded
          against the button it belongs with, and the name is the thing the
          clinician is looking for. The name gets its own line, and the back
          button keeps its own above it. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard/patient-records")} className="-ml-2 shrink-0 gap-1 self-start">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </Button>
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-bold">{patient.full_name}</h1>
            <p className="break-words text-aura-muted">{patient.clinic_name} • {patient.clinician_name}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
            <DialogTrigger asChild>
              {/* B7: destructive action gets low-emphasis styling; the confirm
                  dialog stays the hard stop before deletion */}
              <Button
                variant="ghost"
                disabled={deleting}
                className="gap-1.5 text-aura-coral-strong hover:bg-aura-coral-soft hover:text-aura-coral-strong"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete Patient</DialogTitle>
                <DialogDescription>
                  Are you sure you want to delete {patient.full_name}? This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>Cancel</Button>
                <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
                  {deleting ? "Deleting…" : "Delete"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Patient Info Cards

          Two cards, and only what the screening itself was read against.

          The smoking history, the past respiratory diseases and the current
          symptoms used to be here as well. They are the patient's own notes,
          and they belong with the result they were read against -- so they
          are on the result page now, in the patient information box, where
          the verdict and the notes that give the verdict its meaning sit
          together.

          The age bracket went from the Gender card for the same reason: the
          Age card carries the exact age, and a band beside it is the same
          information in a vaguer form. */}
      <div className="grid gap-8 md:grid-cols-2">
        <motion.div whileHover={cardHover.whileHover} whileTap={cardHover.whileTap}>
          <Card className="aura-panel">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Age</CardTitle>
              <Calendar className="h-4 w-4 shrink-0 text-aura-muted" aria-hidden="true" />
            </CardHeader>
            <CardContent>
              <div className="break-words text-2xl font-bold">{age} years old</div>
              <p className="text-xs text-aura-muted">DOB: {new Date(patient.date_of_birth).toLocaleDateString()}</p>
            </CardContent>
          </Card>
        </motion.div>
        <motion.div whileHover={cardHover.whileHover} whileTap={cardHover.whileTap}>
          <Card className="aura-panel">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Gender</CardTitle>
              <Shield className="h-4 w-4 shrink-0 text-aura-muted" aria-hidden="true" />
            </CardHeader>
            <CardContent>
              <div className="break-words text-2xl font-bold capitalize">{patient.gender}</div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Screenings History

          The smoking history, the past respiratory diseases and the current
          symptoms were here as their own cards. They moved to the result
          page, in the patient information box, because that is where the
          reading they were taken with is shown. */}
      <Card className="aura-panel">
        <CardHeader>
          <CardTitle>Screening History ({screenings.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {screenings.length === 0 ? (
<EmptyState
                icon={FileText}
                title="No screenings yet"
                hint="Start a new screening for this patient to see results here."
                action={
                  <Button onClick={() => navigate("/dashboard/screening")}>
                    Create First Screening
                  </Button>
                }
              />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="aura-table-head sticky top-0 z-10 border-b border-aura-forest/10 bg-white backdrop-blur-md">
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Respiratory</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {screenings.map((s) => (
                    <TableRow key={s.id} className="transition-colors hover:bg-aura-surface-alt">
                      <TableCell>
                        {/* Which reading this is, for this patient. A patient
                            can be screened repeatedly, so "the second one" is
                            the difference between a re-test and a genuine
                            change in the patient's condition. */}
                        <div className="flex items-baseline gap-2">
                          <div>{new Date(s.created_at).toLocaleDateString()}</div>
                          {s.patient_screening_count && s.patient_screening_count > 1 && (
                            <span className="rounded-full bg-aura-surface-alt px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-aura-muted">
                              {s.screening_number} of {s.patient_screening_count}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-aura-muted">{new Date(s.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                      </TableCell>
                      <TableCell>
                        {/* Item 13: confidence travels with the badge — a 51% vs 98%
                            classification should change how a clinician reads it */}
                        <div className="flex flex-col items-start gap-0.5">
                          {getRespBadge(s.respiratory_result)}
                          <ConfidenceChip value={s.respiratory_confidence} />
                        </div>
                      </TableCell>
                      <TableCell>{getStatusBadge(s.status, s.reviewed_by_name)}</TableCell>
                      <TableCell>
                        <Link to={`/dashboard/screenings/${s.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                          View Details
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
