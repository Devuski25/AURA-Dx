"use client"

import { useEffect, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { Loader2, ArrowLeft, Edit, Trash2, Calendar, MapPin, Stethoscope, AlertTriangle, CheckCircle, XCircle, Download, Shield } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import { cn } from "@/lib/utils"
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
import { Separator } from "@/components/ui/separator"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"

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
  tb_result: string
  tb_confidence: number | null
  respiratory_result: string | null
  respiratory_confidence: number | null
  cascade_path: string
  model_version: string
  status: string
  reviewed_by_name: string | null
  reviewed_at: string | null
  created_at: string
}

export function PatientDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [patient, setPatient] = useState<Patient | null>(null)
  const [screenings, setScreenings] = useState<Screening[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)

  useEffect(() => {
    if (id) {
      fetchPatient()
      fetchScreenings()
    }
  }, [id])

  const fetchPatient = async () => {
    if (!id) return
    try {
      let query = supabase
        .from("patient_list_view")
        .select("*")
        .eq("id", id)

      if (user?.role === "admin" && user?.clinic_id) {
        query = query.eq("clinic_id", user.clinic_id)
      }

      const { data, error } = await query.single()
      if (error) throw error
      setPatient(data)
    } catch (error) {
      console.error("Error fetching patient:", error)
      navigate("/patients")
    } finally {
      setLoading(false)
    }
  }

  const fetchScreenings = async () => {
    if (!id) return
    try {
      let query = supabase
        .from("screening_history_view")
        .select("*")
        .eq("patient_id", id)
        .order("created_at", { ascending: false })

      const { data, error } = await query
      if (error) throw error
      setScreenings(data || [])
    } catch (error) {
      console.error("Error fetching screenings:", error)
    }
  }

  const handleDelete = async () => {
    if (!id) return
    setDeleting(true)
    try {
      const { error } = await supabase.from("patients").delete().eq("id", id)
      if (error) throw error
      navigate("/patients")
    } catch (error) {
      console.error("Error deleting patient:", error)
      toast.error("Failed to delete patient")
    } finally {
      setDeleting(false)
      setDeleteConfirmOpen(false)
    }
  }

  const getTbBadge = (result: string) => (
    <Badge variant={result === "TB" ? "destructive" : "success"}>
      {result}
    </Badge>
  )

  const getRespBadge = (result: string | null) => {
    if (!result) return <Badge variant="secondary">N/A</Badge>
    const variants: Record<string, "default" | "success" | "warning" | "destructive"> = {
      Healthy: "success",
      Pneumonia: "destructive",
      COPD: "warning",
    }
    return <Badge variant={variants[result] || "default"}>{result}</Badge>
  }

  const getStatusBadge = (status: string, reviewedBy: string | null) => {
    if (status === "pending_review") return <Badge variant="warning">Pending Review</Badge>
    if (reviewedBy) return <Badge variant="success">Reviewed</Badge>
    return <Badge variant="secondary">{status}</Badge>
  }

  if (loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!patient) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">Patient not found</p>
        <Button variant="outline" onClick={() => navigate("/patients")} className="mt-4">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Patients
        </Button>
      </div>
    )
  }

  const age = Math.floor((new Date().getTime() - new Date(patient.date_of_birth).getTime()) / (365.25 * 24 * 60 * 60 * 1000))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{patient.full_name}</h1>
          <p className="text-muted-foreground">{patient.clinic_name} • {patient.clinician_name}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate("/dashboard/patients")}>
            <Edit className="mr-2 h-4 w-4" />
            Back to Patients
          </Button>
          <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
            <DialogTrigger asChild>
              <Button variant="destructive" disabled={deleting}>
                <Trash2 className="mr-2 h-4 w-4" />
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
                  {deleting ? "Deleting..." : "Delete"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Patient Info Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Age</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{age} years old</div>
            <p className="text-xs text-muted-foreground">DOB: {new Date(patient.date_of_birth).toLocaleDateString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Gender</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold capitalize">{patient.gender}</div>
            <p className="text-xs text-muted-foreground">Age bracket: {patient.age_bracket}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Smoking History</CardTitle>
            <Stethoscope className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {patient.smoking_history ? (
              <>
                <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">Yes</div>
                <p className="text-xs text-muted-foreground">{patient.pack_years} pack-years</p>
              </>
            ) : (
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">No</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Clinic</CardTitle>
            <MapPin className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="font-medium">{patient.clinic_name}</div>
            <p className="text-xs text-muted-foreground">Clinician: {patient.clinician_name}</p>
          </CardContent>
        </Card>
      </div>

      {/* Medical History */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Past Respiratory Diseases</CardTitle>
          </CardHeader>
          <CardContent>
            {patient.past_respiratory_diseases?.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {patient.past_respiratory_diseases.map((d, i) => (
                  <Badge key={i} variant="outline">{d}</Badge>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">None recorded</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Current Symptoms</CardTitle>
          </CardHeader>
          <CardContent>
            {patient.symptoms?.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {patient.symptoms.map((s, i) => (
                  <Badge key={i} variant="secondary">{s}</Badge>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">None recorded</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Screenings History */}
      <Card>
        <CardHeader>
          <CardTitle>Screening History ({screenings.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {screenings.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No screenings yet</p>
              <Button className="mt-4" onClick={() => navigate("/screening")}>
                Create First Screening
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>TB Result</TableHead>
                    <TableHead>Respiratory</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Reviewed By</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {screenings.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <div>{new Date(s.created_at).toLocaleDateString()}</div>
                        <div className="text-xs text-muted-foreground">{new Date(s.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                      </TableCell>
                      <TableCell>{getTbBadge(s.tb_result)}</TableCell>
                      <TableCell>{getRespBadge(s.respiratory_result)}</TableCell>
                      <TableCell>{getStatusBadge(s.status, s.reviewed_by_name)}</TableCell>
                      <TableCell>
                        {s.reviewed_by_name ? (
                          <>
                            {s.reviewed_by_name}
                            <div className="text-xs text-muted-foreground">
                              {new Date(s.reviewed_at!).toLocaleDateString()}
                            </div>
                          </>
                        ) : (
                          <span className="text-muted-foreground">Not reviewed</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => navigate(`/screenings/${s.id}`)}>
                          View Details
                        </Button>
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