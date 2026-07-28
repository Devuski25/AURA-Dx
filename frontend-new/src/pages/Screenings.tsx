"use client"

import { useState, useEffect, useMemo } from "react"
import { Loader2, Search, Filter, ChevronUp, ChevronDown, Download, Eye, AlertTriangle, CheckCircle, Calendar, Stethoscope, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableFooter } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import { cn } from "@/lib/utils"
import { getTbBadge, getRespBadge, getConfidenceColor } from "@/lib/badge-helpers"
import { toast } from "sonner"
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
  patient_dob: string
  patient_gender: string
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

type SortableField = keyof Pick<Screening, "patient_name" | "created_at" | "tb_result" | "respiratory_result" | "status">

export function Screenings() {
  const { user } = useAuth()
  const [screenings, setScreenings] = useState<Screening[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [classFilter, setClassFilter] = useState("all")
  const [genderFilter, setGenderFilter] = useState("all")
  const [sortField, setSortField] = useState<SortableField>("created_at")
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc")
  const [detailScreening, setDetailScreening] = useState<Screening | null>(null)

  useEffect(() => {
    if (user) fetchScreenings()
  }, [user])

  const fetchScreenings = async () => {
    if (!user) return
    setLoading(true)
    try {
      let query = supabase
        .from("screening_history_view")
        .select("*")

      if (user.role === "clinician") {
        query = query.eq("clinician_id", user.id)
      } else if (user.role === "admin" && user.clinic_id) {
        query = query.eq("clinic_id", user.clinic_id)
      }

      const { data, error } = await query.order("created_at", { ascending: false })
      if (error) throw error
      setScreenings(data || [])
    } catch (error) {
      console.error("Error fetching screenings:", error)
    } finally {
      setLoading(false)
    }
  }

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
        s.patient_name.toLowerCase().includes(searchLower)
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
      result = result.filter(s => s.patient_gender === genderFilter)
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
    if (sortField !== field) return <span className="text-muted-foreground"><ChevronUp className="h-3 w-3" /><ChevronDown className="h-3 w-3" /></span>
    if (sortDirection === "asc") return <ChevronUp className="h-3 w-3" />
    if (sortDirection === "desc") return <ChevronDown className="h-3 w-3" />
    return <span className="text-muted-foreground"><ChevronUp className="h-3 w-3" /><ChevronDown className="h-3 w-3" /></span>
  }

  const downloadPDF = async (screeningId: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const response = await fetch(`${import.meta.env.VITE_API_URL || "http://localhost:8001"}/api/screenings/${screeningId}/pdf`, {
        headers: { Authorization: `Bearer ${session?.access_token || ""}` },
      })
      if (response.ok) {
        const blob = await response.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `coughph-screening-${screeningId}.pdf`
        a.click()
        URL.revokeObjectURL(url)
      }
    } catch (error) {
      console.error("PDF download failed:", error)
      toast.error("Failed to download PDF")
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Screening Records</h1>
          <p className="text-muted-foreground">View and manage patient screening records</p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search patient, clinic, clinician..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={classFilter} onValueChange={setClassFilter}>
              <SelectTrigger className="w-[160px]">
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
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Gender" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Screenings Table */}
      <Card>
        <CardHeader>
          <CardTitle>Screenings ({filteredAndSortedScreenings.length} of {screenings.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : filteredAndSortedScreenings.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No screenings found.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="cursor-pointer select-none" onClick={() => handleSort("patient_name")}>
                      <div className="flex items-center gap-1">
                        Patient <SortIcon field="patient_name" />
                      </div>
                    </TableHead>
                    <TableHead>Age / Gender</TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => handleSort("tb_result")}>
                      <div className="flex items-center gap-1">
                        TB Result <SortIcon field="tb_result" />
                      </div>
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => handleSort("respiratory_result")}>
                      <div className="flex items-center gap-1">
                        Respiratory <SortIcon field="respiratory_result" />
                      </div>
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => handleSort("status")}>
                      <div className="flex items-center gap-1">
                        Status <SortIcon field="status" />
                      </div>
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => handleSort("created_at")}>
                      <div className="flex items-center gap-1">
                        Date <SortIcon field="created_at" />
                      </div>
                    </TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAndSortedScreenings.map(screening => (
                    <TableRow key={screening.id} className="hover:bg-muted/50">
                      <TableCell>
                        <div className="font-medium">{screening.patient_name}</div>
                        <div className="text-xs text-muted-foreground">{screening.clinic_name} • {screening.clinician_name}</div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">
                            {Math.floor((new Date().getTime() - new Date(screening.patient_dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000))}y
                          </div>
                          <div className="text-xs text-muted-foreground capitalize">{screening.patient_gender}</div>
                        </div>
                      </TableCell>
                      <TableCell>{getTbBadge(screening.tb_result)}</TableCell>
                      <TableCell>{getRespBadge(screening.respiratory_result)}</TableCell>
                      <TableCell>{getStatusBadge(screening.status, screening.reviewed_by_name)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(screening.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button variant="ghost" size="icon" onClick={() => setDetailScreening(screening)} title="View Details">
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => downloadPDF(screening.id)} title="Download PDF">
                            <Download className="h-4 w-4" />
                          </Button>
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

      {/* Detail Dialog */}
      <Dialog open={!!detailScreening} onOpenChange={open => !open && setDetailScreening(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
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
                    <p className="text-sm text-muted-foreground">Name</p>
                    <p className="font-medium">{detailScreening.patient_name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Age / Gender</p>
                    <p className="font-medium">
                      {Math.floor((new Date().getTime() - new Date(detailScreening.patient_dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000))} years • {detailScreening.patient_gender}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Age Bracket</p>
                    <p className="font-medium">{detailScreening.age_bracket}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Clinic / Clinician</p>
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
                    <p className="text-sm text-muted-foreground">Date</p>
                    <p className="font-medium">{new Date(detailScreening.created_at).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Model Version</p>
                    <p className="font-medium font-mono">{detailScreening.model_version}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Cascade Path</p>
                    <p className="font-medium">{detailScreening.cascade_path}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Audio Duration</p>
                    <p className="font-medium">{detailScreening.audio_duration_sec ? `${detailScreening.audio_duration_sec}s` : "N/A"}</p>
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
                    <div className="p-4 bg-muted/50 rounded-lg">
                      <p className="text-sm text-muted-foreground">Confidence</p>
                      <p className={cn("text-3xl font-bold font-mono", getConfidenceColor(detailScreening.tb_confidence))}>
                        {(detailScreening.tb_confidence ? detailScreening.tb_confidence * 100 : 0).toFixed(1)}%
                      </p>
                    </div>
                    <div className="p-4 bg-muted/50 rounded-lg">
                      <p className="text-sm text-muted-foreground">Model Version</p>
                      <p className="font-mono">{detailScreening.model_version}</p>
                    </div>
                    <div className="p-4 bg-muted/50 rounded-lg">
                      <p className="text-sm text-muted-foreground">Cascade</p>
                      <p className="font-medium">{detailScreening.cascade_path.includes("Tier 2") ? "Continued to Tier 2" : "Stopped at Tier 1"}</p>
                    </div>
                  </div>

                  {detailScreening.tb_probabilities && (
                    <div>
                      <p className="text-sm text-muted-foreground mb-2">Probability Distribution</p>
                      <div className="space-y-3">
                        {Object.entries(detailScreening.tb_probabilities).map(([cls, prob]) => (
                          <div key={cls} className="space-y-1">
                            <div className="flex justify-between text-sm">
                              <span className={cn("font-medium", cls === "TB" ? "text-destructive" : "text-green-600 dark:text-green-400")}>{cls}</span>
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
                <Card className="border-l-4 border-l-blue-500/50">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2">
                        <Stethoscope className="h-5 w-5 text-blue-500" />
                        Tier 2: Respiratory Classifier
                      </CardTitle>
                      {getRespBadge(detailScreening.respiratory_result)}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="p-4 bg-muted/50 rounded-lg">
                        <p className="text-sm text-muted-foreground">Confidence</p>
                        <p className={cn("text-3xl font-bold font-mono", getConfidenceColor(detailScreening.respiratory_confidence))}>
                          {(detailScreening.respiratory_confidence ? detailScreening.respiratory_confidence * 100 : 0).toFixed(1)}%
                        </p>
                      </div>
                    </div>

                    {detailScreening.respiratory_probabilities && (
                      <div>
                        <p className="text-sm text-muted-foreground mb-2">Probability Distribution</p>
                        <div className="space-y-3">
                          {Object.entries(detailScreening.respiratory_probabilities).map(([cls, prob]) => (
                            <div key={cls} className="space-y-1">
                              <div className="flex justify-between text-sm">
                                <span className={cn("font-medium", cls === "Pneumonia" ? "text-destructive" : cls === "COPD" ? "text-yellow-600 dark:text-yellow-400" : "text-green-600 dark:text-green-400")}>{cls}</span>
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
                      <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg dark:bg-yellow-900/20 dark:border-yellow-800">
                        <h4 className="font-semibold text-yellow-700 dark:text-yellow-300 flex items-center gap-2">
                          <AlertTriangle className="h-5 w-5" />
                          Moderate Priority: COPD Suspected
                        </h4>
                        <p className="mt-2 text-sm">Clinical evaluation recommended. Consider spirometry and pulmonology referral.</p>
                      </div>
                    )}

                    {detailScreening.respiratory_result === "Healthy" && (
                      <div className="p-4 bg-green-50 border border-green-200 rounded-lg dark:bg-green-900/20 dark:border-green-800">
                        <h4 className="font-semibold text-green-700 dark:text-green-300 flex items-center gap-2">
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
                    <p className="text-sm text-muted-foreground">Status</p>
                    {getStatusBadge(detailScreening.status, detailScreening.reviewed_by_name)}
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Reviewed By</p>
                    <p className="font-medium">{detailScreening.reviewed_by_name || "Not yet reviewed"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Review Date</p>
                    <p className="font-medium">{detailScreening.reviewed_at ? new Date(detailScreening.reviewed_at).toLocaleString() : "—"}</p>
                  </div>
                  {detailScreening.review_notes && (
                    <div className="md:col-span-3">
                      <p className="text-sm text-muted-foreground">Review Notes</p>
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