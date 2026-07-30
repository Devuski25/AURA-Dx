"use client"

import { useEffect, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { Loader2, ArrowLeft, AlertTriangle, CheckCircle, XCircle, Download, Settings, Share2, Printer, Clock, Stethoscope, FileText, Shield, User, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { supabase } from "@/lib/supabase"
import { cn } from "@/lib/utils"
import { getTbBadge, getRespBadge, getConfidenceColor } from "@/lib/badge-helpers"

interface ScreeningDetail {
  id: string
  patient_id: string
  clinic_id: string
  clinician_id: string
  audio_file_path: string | null
  audio_duration_sec: number | null
  tb_result: string
  tb_confidence: number | null
  tb_probabilities: Record<string, number> | null
  respiratory_result: string | null
  respiratory_confidence: number | null
  respiratory_probabilities: Record<string, number> | null
  cascade_path: string
  model_version: string
  status: string
  reviewed_by: string | null
  reviewed_at: string | null
  review_notes: string | null
  created_at: string
  updated_at: string
  patient_name: string
  patient_dob: string
  age_bracket: string
  patient_gender: string
  clinic_name: string
  clinician_name: string
  reviewed_by_name: string | null
}

export function ScreeningDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [screening, setScreening] = useState<ScreeningDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (id) fetchScreening()
  }, [id])

  const fetchScreening = async () => {
    if (!id) return
    try {
      const { data, error } = await supabase
        .from("screening_history_view")
        .select("*")
        .eq("id", id)
        .single()
      if (error) throw error
      setScreening(data)
    } catch (error) {
      console.error("Error fetching screening:", error)
      navigate("/dashboard")
    } finally {
      setLoading(false)
    }
  }

  const downloadPDF = async () => {
    if (!screening) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8001"
      const response = await fetch(`${API_BASE}/api/screenings/${screening.id}/pdf`, {
        headers: {
          Authorization: `Bearer ${token || ""}`,
        },
      })
      if (response.ok) {
        const blob = await response.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `coughph-screening-${screening.id}.pdf`
        a.click()
        URL.revokeObjectURL(url)
      }
    } catch (error) {
      console.error("PDF download failed:", error)
    }
  }

  if (loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!screening) {
    return (
      <div className="text-center py-8">
        <p className="text-cough-muted">Screening not found</p>
        <Button variant="outline" onClick={() => navigate("/dashboard")} className="mt-4">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Dashboard
        </Button>
      </div>
    )
  }

  const patientAge = Math.floor(
    (new Date().getTime() - new Date(screening.patient_dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000)
  )

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold">Screening Result</h1>
            <p className="text-cough-muted">
              Patient: {screening.patient_name} • {screening.clinic_name}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={downloadPDF} disabled={!screening}>
              <Download className="mr-2 h-4 w-4" />
              Download PDF
            </Button>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" />
              Print
            </Button>
          </div>
        </div>
      </div>

      {/* Patient Info */}
      <Card>
        <CardHeader>
          <CardTitle>Patient Information</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div>
            <p className="text-sm text-cough-muted">Name</p>
            <p className="font-medium">{screening.patient_name}</p>
          </div>
          <div>
            <p className="text-sm text-cough-muted">Age / Gender</p>
            <p className="font-medium">{patientAge} years • {screening.patient_gender}</p>
          </div>
          <div>
            <p className="text-sm text-cough-muted">Age Bracket</p>
            <p className="font-medium">{screening.age_bracket}</p>
          </div>
          <div>
            <p className="text-sm text-cough-muted">Clinic / Clinician</p>
            <p className="font-medium">{screening.clinic_name} / {screening.clinician_name}</p>
          </div>
        </CardContent>
      </Card>

      {/* Screening Metadata */}
      <Card>
        <CardHeader>
          <CardTitle>Screening Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div>
            <p className="text-sm text-cough-muted">Screening Date</p>
            <p className="font-medium">{new Date(screening.created_at).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-sm text-cough-muted">Model Version</p>
            <p className="font-medium font-mono">{screening.model_version}</p>
          </div>
          <div>
            <p className="text-sm text-cough-muted">Cascade Path</p>
            <p className="font-medium">{screening.cascade_path}</p>
          </div>
          <div>
            <p className="text-sm text-cough-muted">Audio Duration</p>
            <p className="font-medium">{screening.audio_duration_sec ? `${screening.audio_duration_sec}s` : "N/A"}</p>
          </div>
        </CardContent>
      </Card>

      {/* Tier 1: TB Gatekeeper */}
      <Card className="border-l-4 border-l-destructive/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Tier 1: TB Gatekeeper
            </CardTitle>
            {getTbBadge(screening.tb_result)}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="p-4 bg-cough-surface-alt rounded-lg">
              <p className="text-sm text-cough-muted">Confidence</p>
              <p className={cn("text-3xl font-bold font-mono", getConfidenceColor(screening.tb_confidence))}>
                {(screening.tb_confidence ? screening.tb_confidence * 100 : 0).toFixed(1)}%
              </p>
            </div>
            <div className="p-4 bg-cough-surface-alt rounded-lg">
              <p className="text-sm text-cough-muted">Model Version</p>
              <p className="font-mono">{screening.model_version}</p>
            </div>
            <div className="p-4 bg-cough-surface-alt rounded-lg">
              <p className="text-sm text-cough-muted">Cascade</p>
              <p className="font-medium">{screening.cascade_path.includes("Tier 2") ? "Continued to Tier 2" : "Stopped at Tier 1"}</p>
            </div>
          </div>

          {screening.tb_probabilities && (
            <div>
              <p className="text-sm text-cough-muted mb-2">Probability Distribution</p>
              <div className="space-y-3">
                {Object.entries(screening.tb_probabilities).map(([cls, prob]) => (
                  <div key={cls} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className={cn("font-medium", cls === "TB" ? "text-destructive" : "text-green-600")}>{cls}</span>
                      <span className="font-mono">{(prob * 100).toFixed(1)}%</span>
                    </div>
                    <Progress value={prob * 100} className="h-2" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {screening.tb_result === "TB" && (
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
      {screening.respiratory_result && (
        <Card className="border-l-4 border-l-blue-500/50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Stethoscope className="h-5 w-5 text-blue-500" />
                Tier 2: Respiratory Classifier
              </CardTitle>
              {getRespBadge(screening.respiratory_result)}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="p-4 bg-cough-surface-alt rounded-lg">
                <p className="text-sm text-cough-muted">Confidence</p>
                <p className={cn("text-3xl font-bold font-mono", getConfidenceColor(screening.respiratory_confidence))}>
                  {(screening.respiratory_confidence ? screening.respiratory_confidence * 100 : 0).toFixed(1)}%
                </p>
              </div>
            </div>

            {screening.respiratory_probabilities && (
              <div>
                <p className="text-sm text-cough-muted mb-2">Probability Distribution</p>
                <div className="space-y-3">
                  {Object.entries(screening.respiratory_probabilities).map(([cls, prob]) => (
                    <div key={cls} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className={cn("font-medium", cls === "Pneumonia" ? "text-destructive" : cls === "COPD" ? "text-yellow-600" : "text-green-600")}>{cls}</span>
                        <span className="font-mono">{(prob * 100).toFixed(1)}%</span>
                      </div>
                      <Progress value={prob * 100} className="h-2" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {screening.respiratory_result === "Pneumonia" && (
              <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
                <h4 className="font-semibold text-destructive flex items-center gap-2">
                  <AlertCircle className="h-5 w-5" />
                  High Priority: Pneumonia Suspected
                </h4>
                <p className="mt-2 text-sm">Urgent clinical evaluation recommended. Consider chest imaging and antibiotics per guidelines.</p>
              </div>
            )}

            {screening.respiratory_result === "COPD" && (
              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <h4 className="font-semibold text-yellow-700 flex items-center gap-2">
                  <AlertCircle className="h-5 w-5" />
                  Moderate Priority: COPD Suspected
                </h4>
                <p className="mt-2 text-sm">Clinical evaluation recommended. Consider spirometry and pulmonology referral.</p>
              </div>
            )}

            {screening.respiratory_result === "Healthy" && (
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                <h4 className="font-semibold text-green-700 flex items-center gap-2">
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
            <p className="text-sm text-cough-muted">Status</p>
            <Badge variant={screening.status === "pending_review" ? "warning" : screening.reviewed_by ? "success" : "secondary"}>
              {screening.status === "pending_review" ? "Pending Review" : screening.reviewed_by ? "Reviewed" : screening.status}
            </Badge>
          </div>
          <div>
            <p className="text-sm text-cough-muted">Reviewed By</p>
            <p className="font-medium">{screening.reviewed_by_name || "Not yet reviewed"}</p>
          </div>
          <div>
            <p className="text-sm text-cough-muted">Review Date</p>
            <p className="font-medium">{screening.reviewed_at ? new Date(screening.reviewed_at).toLocaleString() : "—"}</p>
          </div>
          {screening.review_notes && (
            <div className="md:col-span-3">
              <p className="text-sm text-cough-muted">Review Notes</p>
              <p className="font-medium">{screening.review_notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <Card>
        <CardFooter className="flex justify-between">
          <Button variant="outline" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={downloadPDF}>
              <Download className="mr-2 h-4 w-4" />
              Download PDF
            </Button>
          </div>
        </CardFooter>
      </Card>
    </div>
  )
}