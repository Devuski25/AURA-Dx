"use client"

import { useEffect, useState, useMemo } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { useParams, useNavigate } from "react-router-dom"
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle,
  Download,
  Printer,
  AlertCircle,
  Check,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import { getApiUrl } from "@/lib/api"
import { useCountUp } from "@/hooks/useCountUp"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "sonner"

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

/* ---------- Theme colors ---------- */
const MINT = "#1E9E73"
const CORAL = "#E2543A"

/* ---------- Shared date/time formatting (locale-aware) ---------- */
const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })

/* ---------- Field label ---------- */
function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-aura-muted">{children}</div>
  )
}

/* ---------- Confidence ring ---------- */
function ConfidenceRing({ value, flagged }: { value: number; flagged: boolean }) {
  const radius = 56
  const circumference = 2 * Math.PI * radius
  // Convert fraction (0-1) to percentage (0-100) before computing the ring
  const pct = Math.min(Math.max(value * 100, 0), 100)
  const offset = circumference - (pct / 100) * circumference
  const color = flagged ? CORAL : MINT
  const shownPct = useCountUp(Math.round(pct))
  return (
    <div className="relative h-[132px] w-[132px]" role="img" aria-label={`Confidence ${pct.toFixed(0)} percent`}>
      <svg width="132" height="132" viewBox="0 0 132 132" className="-rotate-90 text-aura-border-soft" aria-hidden="true">
        <circle cx="66" cy="66" r={radius} stroke="currentColor" strokeWidth="12" fill="none" />
        <motion.circle
          cx="66"
          cy="66"
          r={radius}
          stroke={color}
          strokeWidth="12"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ type: "spring", stiffness: 60, damping: 20 }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className={cn("font-display text-[26px] font-bold leading-none tabular-nums", flagged ? "text-aura-coral" : "text-aura-mint")}>
          {shownPct}%
        </div>
        <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-aura-muted">Confidence</div>
      </div>
    </div>
  )
}

/* ---------- Status pill ---------- */
function TierStatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 font-mono text-[11px] font-semibold",
        ok ? "bg-aura-mint-soft text-aura-pine" : "bg-aura-coral-soft text-aura-coral-strong"
      )}
    >
      {ok ? <Check className="h-3 w-3" strokeWidth={2.2} /> : <AlertTriangle className="h-3 w-3" strokeWidth={2.2} />}
      {label}
    </div>
  )
}

/* ---------- Cascade stepper ---------- */
function CascadeStepper({ path }: { path: string }) {
  const steps = path
    .split("→")
    .map(s => s.trim())
    .filter(Boolean)
  const labels: Record<string, string> = {
    "Tier 1": "TIER 1 · TB GATEKEEPER",
    "Tier 2": "TIER 2 · RESPIRATORY CLASSIFIER",
  }
  return (
    <div className="mt-1.5 flex flex-wrap items-center">
      {steps.map((step, i) => (
        <div key={i} className="flex items-center">
          {i > 0 && (
            <div className="relative mx-1 h-px w-[34px] bg-[repeating-linear-gradient(90deg,#E1E7E2_0_5px,transparent_5px_9px)]">
              <span className="absolute -right-px -top-[3px] border-l-[5px] border-t-[3.5px] border-b-[3.5px] border-l-aura-border-soft border-t-transparent border-b-transparent" />
            </div>
          )}
          <div className="flex items-center gap-2 rounded-full bg-aura-mint-soft px-3 py-1.5 font-mono text-[11px] font-medium uppercase tracking-wide text-aura-forest">
            {labels[step] ?? step.toUpperCase()}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ---------- Probability bar ---------- */
function ProbabilityBar({ label, prob, color }: { label: string; prob: number; color: string }) {
  const pct = Math.min(Math.max(prob * 100, 0), 100)
  const gradient =
    color === CORAL ? "linear-gradient(90deg,#F0725C,#E2543A)" : "linear-gradient(90deg,#4CC490,#1E9E73)"
  return (
    <div className="mb-4 last:mb-0">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-aura-ink">
          <span aria-hidden="true" className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: color }} />
          {label}
        </div>
        <div className="font-mono text-[13px] font-semibold tabular-nums text-aura-ink">{pct.toFixed(1)}%</div>
      </div>
      <div
        className="h-3 w-full overflow-hidden rounded-full bg-aura-surface-alt"
        role="progressbar"
        aria-label={`${label} probability`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-valuetext={`${pct.toFixed(1)}%`}
      >
        <motion.div
          className="h-full rounded-full"
          style={{ background: gradient }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={useReducedMotion() ? { duration: 0 } : { type: "spring", stiffness: 120, damping: 20 }}
        />
      </div>
    </div>
  )
}

/* ---------- Waveform (screening details) ---------- */
function Waveform() {
  const bars = [4, 9, 14, 6, 16, 10, 5, 12, 8, 15, 6, 11]
  return (
    <div aria-hidden="true" className="flex h-4 items-end gap-[2px] opacity-50">
      {bars.map((h, i) => (
        <span key={i} className="w-[2px] rounded-[1px] bg-aura-forest-light" style={{ height: `${h}px` }} />
      ))}
    </div>
  )
}

/* ---------- Info card ---------- */
function InfoCard({ title, className, children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-[14px] border border-aura-border-soft/60 bg-aura-sage/40 py-5 px-6", className)}>
      <h2 className="mb-4 flex items-center gap-2 font-display text-[13px] font-semibold uppercase tracking-[0.04em] text-aura-muted">
        {title}
      </h2>
      {children}
    </div>
  )
}

/* ---------- Result banner ---------- */
type Severity = "critical" | "high" | "moderate" | "clear"

const BANNER_CONFIG: Record<
  Severity,
  { label: string; detail: string; container: string; icon: React.ReactNode; title: string; sub: string }
> = {
  critical: {
    label: "ACTIVE TB SUSPECTED",
    detail: "Flagged · refer for confirmatory testing immediately",
    container: "border-aura-coral bg-aura-coral-soft",
    icon: <AlertTriangle className="h-6 w-6 text-aura-coral" />,
    title: "text-aura-coral-strong",
    sub: "text-aura-coral-strong",
  },
  high: {
    label: "PNEUMONIA SUSPECTED",
    detail: "Flagged · urgent clinical evaluation recommended",
    container: "border-aura-coral bg-aura-coral-soft",
    icon: <AlertTriangle className="h-6 w-6 text-aura-coral" />,
    title: "text-aura-coral-strong",
    sub: "text-aura-coral-strong",
  },
  moderate: {
    label: "COPD DETECTED",
    detail: "Moderate finding · clinical evaluation recommended",
    container: "border-aura-warning-border bg-aura-warning-soft",
    icon: <AlertCircle className="h-6 w-6 text-aura-warning" />,
    title: "text-aura-warning-strong",
    sub: "text-aura-warning-strong",
  },
  clear: {
    label: "NO ACUTE RESPIRATORY PATHOLOGY",
    detail: "No urgent pathology detected · routine follow-up",
    container: "border-aura-mint/60 bg-aura-mint-soft",
    icon: <CheckCircle className="h-6 w-6 text-aura-mint" />,
    title: "text-aura-forest",
    sub: "text-aura-forest",
  },
}

function ResultBanner({ screening }: { screening: ScreeningDetail }) {
  // Banner must reflect the MOST SEVERE finding: TB > Pneumonia > COPD > no findings
  const severity: Severity =
    screening.tb_result === "TB"
      ? "critical"
      : screening.respiratory_result === "Pneumonia"
      ? "high"
      : screening.respiratory_result === "COPD"
      ? "moderate"
      : "clear"
  const cfg = BANNER_CONFIG[severity]
  const reduceMotion = useReducedMotion()

  return (
    <motion.div
      role="status"
      initial={reduceMotion ? false : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 28 }}
      className={cn("mb-6 flex items-center gap-4 rounded-2xl border p-5 shadow-sm", cfg.container)}
    >
      <div className={cn("relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white shadow-sm")}>
        {/* Severity pulse — only for flagged results */}
        {severity !== "clear" && !reduceMotion && (
          <motion.span
            aria-hidden="true"
            className="absolute inset-0 rounded-full"
            style={{ boxShadow: "0 0 0 2px currentColor" }}
            animate={{ scale: [1, 1.45], opacity: [0.5, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
          />
        )}
        {cfg.icon}
      </div>
      <div>
        <p className={cn("font-display text-xl font-bold leading-tight tracking-wide", cfg.title)}>{cfg.label}</p>
        <p className={cn("mt-1 font-mono text-[11px] uppercase tracking-[0.14em]", cfg.sub)}>{cfg.detail}</p>
      </div>
    </motion.div>
  )
}

/* ---------- Loading skeleton ---------- */
function ScreeningSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-24 animate-pulse rounded-2xl bg-aura-sage" />
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="h-32 animate-pulse rounded-[14px] bg-aura-sage" />
        ))}
      </div>
      <div className="h-48 animate-pulse rounded-[14px] bg-aura-sage" />
    </div>
  )
}

/* ---------- Error state ---------- */
function ScreeningError({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-[14px] border border-aura-coral/30 bg-aura-coral-soft px-6 py-14 text-center">
      <AlertTriangle className="h-8 w-8 text-aura-coral" />
      <div>
        <h3 className="font-display text-lg font-semibold text-aura-ink">Unable to load screening result</h3>
        <p className="mt-1 text-sm text-aura-muted">
          {message || "The screening data could not be loaded. Check your connection and try again."}
        </p>
      </div>
    </div>
  )
}

/* ---------- Tier result card ---------- */
function TierCard({
  eyebrow,
  name,
  flagged,
  statusLabel,
  confidence,
  modelVersion,
  decisions,
  className,
  children,
}: {
  eyebrow: string
  name: string
  flagged: boolean
  statusLabel: string
  confidence: number | null
  modelVersion: string | null
  decisions?: { label: string; value: string }[]
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[16px] border border-aura-border-soft bg-aura-elevated",
        flagged ? "border-l-4 border-l-aura-coral" : "border-l-4 border-l-aura-mint",
        className
      )}
    >
      <div className="flex items-center justify-between gap-4 border-b border-aura-border-soft px-6 py-5">
        <div className="flex items-center gap-2.5">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-aura-muted">{eyebrow}</div>
            <div className="font-display text-[17px] font-semibold text-aura-ink">{name}</div>
          </div>
        </div>
        <TierStatusPill ok={!flagged} label={statusLabel} />
      </div>
      <div className="grid gap-6 px-4 py-5 sm:gap-8 sm:px-6 sm:py-6 sm:grid-cols-[200px_1fr]">
        <div className="flex flex-col items-center gap-4 sm:items-start">
          <ConfidenceRing value={confidence ?? 0} flagged={flagged} />
          {modelVersion && (
            <div>
              <FieldLabel>Model Version</FieldLabel>
              <div className="font-mono text-[12.5px] font-medium text-aura-ink">{modelVersion}</div>
            </div>
          )}
          {decisions?.map((d, i) => (
            <div key={i}>
              <FieldLabel>{d.label}</FieldLabel>
              <div className="text-[13px] font-medium text-aura-ink">{d.value}</div>
            </div>
          ))}
        </div>
        <div className="max-w-2xl">{children}</div>
      </div>
    </div>
  )
}

/* ---------- Probability color helper ---------- */
function tierColor(tier: "tb" | "resp", cls: string): string {
  if (tier === "tb") return cls === "TB" ? CORAL : MINT
  return cls === "Healthy" ? MINT : CORAL
}

export function ScreeningDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { accessToken } = useAuth()
  const [screening, setScreening] = useState<ScreeningDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (id && accessToken) fetchScreening()
  }, [id, accessToken])

  const fetchScreening = async () => {
    if (!id || !accessToken) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(getApiUrl(`/api/screenings/${id}`), {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || "Screening not found")
      }
      const data = await res.json()
      setScreening(data)
    } catch (error) {
      console.error("Error fetching screening:", error)
      setError(error instanceof Error ? error.message : "Failed to load screening")
    } finally {
      setLoading(false)
    }
  }

  const downloadPDF = async () => {
    if (!screening) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        toast.error("You must be signed in to download a PDF")
        return
      }
      const response = await fetch(getApiUrl(`/api/screenings/${screening.id}/pdf`), {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      })
      if (!response.ok) {
        toast.error("Failed to download PDF")
        return
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `aura-dx-screening-${screening.id}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error("PDF download failed:", error)
      toast.error("Failed to download PDF")
    }
  }

  const [reviewDialogOpen, setReviewDialogOpen] = useState(false)
  const [reviewNotes, setReviewNotes] = useState("")
  const [reviewSubmitting, setReviewSubmitting] = useState(false)
  const reduceMotion = useReducedMotion()
  const sectionSpring = { type: "spring" as const, stiffness: 300, damping: 28 }

  const handleReview = async () => {
    if (!screening || !accessToken) return
    setReviewSubmitting(true)
    try {
      const res = await fetch(getApiUrl(`/api/screenings/${screening.id}/review`), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ review_notes: reviewNotes }),
      })
      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.detail || "Failed to submit review")
      }
      toast.success("Review submitted")
      setReviewDialogOpen(false)
      setReviewNotes("")
      fetchScreening()
    } catch (error) {
      console.error("Error submitting review:", error)
      toast.error(error instanceof Error ? error.message : "Failed to submit review")
    } finally {
      setReviewSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-4xl pb-10">
        <ScreeningSkeleton />
      </div>
    )
  }

  if (!screening || error) {
    return (
      <div className="mx-auto w-full max-w-4xl pb-10">
        <ScreeningError message={error ?? undefined} />
      </div>
    )
  }

  const patientAge = (() => {
    const today = new Date()
    const birthDate = new Date(screening.patient_dob)
    let age = today.getFullYear() - birthDate.getFullYear()
    const monthDiff = today.getMonth() - birthDate.getMonth()
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--
    }
    return age
  })()

  /* Tier flagging */
  const tbFlagged = screening.tb_result === "TB"
  const respFlagged = screening.respiratory_result !== null && screening.respiratory_result !== "Healthy"

  return (
    <div className="mx-auto w-full max-w-4xl pb-10">
      {/* Prompt status banner above the title */}
      <ResultBanner screening={screening} />

      {/* Header / topbar */}
      <motion.div initial={reduceMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, ...sectionSpring }} className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-aura-ink">Screening Result</h1>
          <div className="mt-1 flex items-center gap-2 text-[13.5px] text-aura-muted">
            <strong className="font-semibold text-aura-ink">{screening.patient_name}</strong>
            <span className="h-[3px] w-[3px] rounded-full bg-aura-muted" />
            {screening.clinic_name}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end print:hidden">
          {screening.status === "pending_review" && (
            <Button onClick={() => setReviewDialogOpen(true)} className="gap-2">
              <CheckCircle className="h-4 w-4" />
              Review Screening
            </Button>
          )}
          <Button variant="outline" onClick={downloadPDF} disabled={!screening} className="gap-2">
            <Download className="h-4 w-4" />
            Download PDF
          </Button>
          <Button variant="outline" onClick={() => window.print()} className="gap-2">
            <Printer className="h-4 w-4" />
            Print
          </Button>
        </div>
      </motion.div>

      {/* Patient Information */}
      <motion.div initial={reduceMotion ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12, ...sectionSpring }}>
      <InfoCard title="Patient Information">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
          <div>
            <FieldLabel>Name</FieldLabel>
            <div className="text-[13.5px] font-medium text-aura-ink">{screening.patient_name}</div>
          </div>
          <div>
            <FieldLabel>Age / Gender</FieldLabel>
            <div className="text-[13.5px] font-medium text-aura-ink">{patientAge} years · {screening.patient_gender}</div>
          </div>
          <div>
            <FieldLabel>Age Bracket</FieldLabel>
            <div className="text-[13.5px] font-medium text-aura-ink">{screening.age_bracket}</div>
          </div>
          <div>
            <FieldLabel>Clinic / Clinician</FieldLabel>
            <div className="text-[13.5px] font-medium leading-snug text-aura-ink">
              {screening.clinic_name}
              <br />
              {screening.clinician_name}
            </div>
          </div>
        </div>
      </InfoCard>
      </motion.div>
      {/* Screening Details */}
      <motion.div initial={reduceMotion ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18, ...sectionSpring }} className="mt-6">
      <InfoCard title="Screening Details">
        <div className="mb-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
          <div>
            <FieldLabel>Screening Date</FieldLabel>
            <div className="text-[13.5px] font-medium tabular-nums text-aura-ink">{dateTimeFormat.format(new Date(screening.created_at))}</div>
          </div>
          <div>
            <FieldLabel>Model Version</FieldLabel>
            <div className="font-mono text-[12px] font-medium text-aura-ink">{screening.model_version}</div>
          </div>
          <div>
            <FieldLabel>Audio Duration</FieldLabel>
            <div className="text-[13.5px] font-medium text-aura-ink">
              {screening.audio_duration_sec ? `${screening.audio_duration_sec}s` : "N/A"}
            </div>
          </div>
          <div className="flex items-end">
            <Waveform />
          </div>
        </div>
        <FieldLabel>Cascade Path</FieldLabel>
        <CascadeStepper path={screening.cascade_path} />
      </InfoCard>
      </motion.div>

      {/* Tier 1: TB Gatekeeper */}
      <motion.div initial={reduceMotion ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24, ...sectionSpring }}>
      <TierCard
        className="mt-6"
        eyebrow="Tier 1"
        name="TB Gatekeeper"
        flagged={tbFlagged}
        statusLabel={tbFlagged ? "TB Detected" : "Non-TB"}
        confidence={screening.tb_confidence ?? 0}
        modelVersion={screening.model_version}
        decisions={[
          { label: "Cascade Decision", value: screening.cascade_path.includes("Tier 2") ? "Continued to Tier 2" : "Stopped at Tier 1" },
        ]}
      >
        {screening.tb_probabilities && (
          <div>
            <div className="mb-4 font-mono text-[10px] uppercase tracking-[0.08em] text-aura-muted">
              Probability Distribution
            </div>
            {useMemo(() => Object.entries(screening.tb_probabilities!).map(([cls, prob]) => (
              <ProbabilityBar key={cls} label={cls} prob={prob} color={tierColor("tb", cls)} />
            )), [screening.tb_probabilities])}
          </div>
        )}
        {tbFlagged && (
          <div className="mt-5 rounded-lg border border-aura-coral/20 bg-aura-coral-soft p-4">
            <h3 className="flex items-center gap-2 font-semibold text-aura-coral">
              <AlertTriangle className="h-5 w-5" />
              High Priority: TB Detected
            </h3>
            <p className="mt-2 text-sm text-aura-ink">Immediate referral for confirmatory TB testing recommended. Follow local TB protocols.</p>
          </div>
        )}
      </TierCard>
      </motion.div>

      {/* Tier 2: Respiratory Classifier */}
      <motion.div initial={reduceMotion ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.30, ...sectionSpring }}>
      {screening.respiratory_result && (
        <TierCard
          className="mt-6"
          eyebrow="Tier 2"
          name="Respiratory Classifier"
          flagged={respFlagged}
          statusLabel={screening.respiratory_result || "Healthy"}
          confidence={screening.respiratory_confidence ?? 0}
          modelVersion={screening.model_version}
          decisions={[
            { label: "Cascade Decision", value: "Final Classification" },
          ]}
        >
          {screening.respiratory_probabilities && (
            <div>
              <div className="mb-4 font-mono text-[10px] uppercase tracking-[0.08em] text-aura-muted">
                Probability Distribution
              </div>
              {useMemo(() => Object.entries(screening.respiratory_probabilities!).map(([cls, prob]) => (
                <ProbabilityBar key={cls} label={cls} prob={prob} color={tierColor("resp", cls)} />
              )), [screening.respiratory_probabilities])}
            </div>
          )}

          {screening.respiratory_result === "Pneumonia" && (
            <div className="mt-5 rounded-lg border border-aura-coral/20 bg-aura-coral-soft p-4">
              <h3 className="flex items-center gap-2 font-semibold text-aura-coral">
                <AlertCircle className="h-5 w-5" />
                High Priority: Pneumonia Suspected
              </h3>
              <p className="mt-2 text-sm text-aura-ink">Urgent clinical evaluation recommended. Consider chest imaging and antibiotics per guidelines.</p>
            </div>
          )}

          {screening.respiratory_result === "COPD" && (
            <div className="mt-5 rounded-lg bg-aura-sage p-4">
              <h3 className="flex items-center gap-2 font-semibold text-aura-forest">
                <AlertCircle className="h-5 w-5" />
                Moderate Priority: COPD Suspected
              </h3>
              <p className="mt-2 text-sm text-aura-ink">Clinical evaluation recommended. Consider spirometry and pulmonology referral.</p>
            </div>
          )}

          {screening.respiratory_result === "Healthy" && (
            <div className="mt-5 rounded-lg bg-aura-sage p-4">
                <h3 className="flex items-center gap-2 font-semibold text-aura-mint">
                  <CheckCircle className="h-5 w-5" />
                  Low Priority: No Acute Findings
              </h3>
              <p className="mt-2 text-sm text-aura-ink">No urgent action required. Routine follow-up as clinically indicated.</p>
            </div>
          )}
        </TierCard>
      )}
      </motion.div>

      {/* Review Status */}
      <motion.div initial={reduceMotion ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.36, ...sectionSpring }} className="mt-6 rounded-[14px] border border-aura-border-soft bg-aura-elevated py-5 px-6">
        <h2 className="mb-4 flex items-center gap-2 font-display text-[13px] font-semibold uppercase tracking-[0.04em] text-aura-muted">
          Review Status
        </h2>
        <div className="grid grid-cols-1 gap-5">
          <div>
            <FieldLabel>Status</FieldLabel>
            <div
              className={cn(
                "inline-flex items-center rounded-full px-3 py-1 font-mono text-[11px] font-semibold",
                screening.status === "pending_review"
                  ? "bg-aura-coral-soft text-aura-coral-strong"
                  : screening.reviewed_by
                  ? "bg-aura-mint-soft text-aura-pine"
                  : "bg-aura-sage text-aura-forest"
              )}
            >
              {screening.status === "pending_review" ? "Pending Review" : screening.reviewed_by ? "Reviewed" : screening.status}
            </div>
          </div>
          {screening.review_notes && (
            <div>
              <FieldLabel>Review Notes</FieldLabel>
              <div className="text-sm font-medium text-aura-ink">{screening.review_notes}</div>
            </div>
          )}
        </div>
      </motion.div>
      {/* Actions */}
      <div className="mt-6 print:hidden">
        <Button variant="outline" onClick={() => navigate("/dashboard")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Dashboard
        </Button>
      </div>

      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review Screening</DialogTitle>
            <DialogDescription>
              Add clinical notes for this screening. Submitting marks it as reviewed.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reviewNotes}
            onChange={e => setReviewNotes(e.target.value)}
            placeholder="Review notes (optional)"
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleReview} disabled={reviewSubmitting}>
              {reviewSubmitting ? "Submitting…" : "Submit Review"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
