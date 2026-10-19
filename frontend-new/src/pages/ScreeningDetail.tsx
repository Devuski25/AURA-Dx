"use client"

import { useEffect, useState, useMemo } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { useParams, useNavigate } from "react-router-dom"
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle,
  Download,
  AlertCircle,
  Check,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import { getApiUrl } from "@/lib/api"
import { invalidate } from "@/hooks/useCachedData"
import { useCountUp } from "@/hooks/useCountUp"
import { Textarea } from "@/components/ui/textarea"
import { InterpretationPanel } from "@/components/InterpretationPanel"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "sonner"

/** One recorded take, as scored independently by the inference service. */
interface ClipScore {
  index: number
  duration_sec: number
  stage1_healthy_prob: number
  stage1_routed_to_stage2: boolean
  stage2_pneumonia_prob: number | null
  healthy_prob: number
  pneumonia_prob: number
  copd_prob: number
  clip_label: string
}

interface ScreeningDetail {
  id: string
  patient_id: string
  clinic_id: string
  clinician_id: string
  audio_file_path: string | null
  audio_duration_sec: number | null
  respiratory_result: string | null
  respiratory_confidence: number | null
  respiratory_probabilities: Record<string, number> | null
  cascade_path: string | null
  recording_paths: string[] | null
  recording_scores: { per_clip?: ClipScore[]; fusion?: Record<string, unknown> } | null
  model_version: string
  status: string
  // Interpretation of the fused scores. Nullable throughout: rows written
  // before the interpretation layer carry NULL and render without the clinical
  // panel rather than with a fabricated confidence level.
  interpretation_status: string | null
  confidence_level: string | null
  recommendation_code: string | null
  decision_rule: string | null
  decision_detail: string | null
  band_metric: string | null
  band_position: number | null
  low_agreement: boolean | null
  recordings_total: number | null
  recordings_flagged: number | null
  reviewed_by: string | null
  reviewed_at: string | null
  review_notes: string | null
  created_at: string
  updated_at: string
  patient_name: string | null
  patient_dob: string
  age_bracket: string
  patient_gender: string
  clinic_name: string
  clinician_name: string
  reviewed_by_name: string | null
}

/* ---------- Theme colors ---------- */
/* Token values, resolved from CSS custom properties so the SVG strokes track
   the design tokens instead of duplicating hex literals. */
const MINT = "var(--color-aura-mint)"
const CORAL = "var(--color-aura-coral)"

/* ---------- Shared date/time formatting (locale-aware) ---------- */
const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })

/* ---------- Field label ---------- */
function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 font-mono text-[13.5px] uppercase tracking-[0.08em] text-aura-muted">{children}</div>
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
        <div className="mt-1 font-mono text-[13.5px] uppercase tracking-[0.08em] text-aura-muted">Confidence</div>
      </div>
    </div>
  )
}

/* ---------- Status pill ---------- */
function TierStatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 font-mono text-[13px] font-semibold",
        ok ? "bg-aura-mint-soft text-aura-pine" : "bg-aura-coral-soft text-aura-coral-strong"
      )}
    >
      {ok ? <Check className="h-3 w-3" strokeWidth={2.2} /> : <AlertTriangle className="h-3 w-3" strokeWidth={2.2} />}
      {label}
    </div>
  )
}

/* ---------- Probability bar ---------- */
function ProbabilityBar({ label, prob, color }: { label: string; prob: number; color: string }) {
  const pct = Math.min(Math.max(prob * 100, 0), 100)
  const gradient =
    color === CORAL
      ? "linear-gradient(90deg, var(--color-aura-coral), var(--color-aura-coral-strong))"
      : "linear-gradient(90deg, var(--color-aura-mint), var(--color-aura-pine))"
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

/* ---------- Take durations (screening details) ----------
 *
 * This replaces a decorative "waveform" that drew twelve bars from a hardcoded
 * array of heights. It looked like the patient's recording and meant nothing --
 * the same twelve bars appeared for every screening, including rows with no
 * audio at all. A clinical screen showing invented data shaped like data is
 * worse than showing none.
 *
 * These bars are real: each one is the measured length of one recorded take,
 * scaled against the longest take in the set. The widths therefore answer a
 * question a clinician actually asks -- was one take clipped short? -- and the
 * numbers are in the tooltip and in the per-take table further down.
 *
 * Nothing is drawn when the per-take scores are missing, because there is
 * genuinely nothing to show.
 */
function TakeDurations({ takes }: { takes: Array<{ duration_sec?: number }> }) {
  const usable = takes.filter(t => typeof t.duration_sec === "number" && t.duration_sec > 0)
  if (usable.length === 0) return null

  const longest = Math.max(...usable.map(t => t.duration_sec as number), 0.001)

  return (
    <div>
      <FieldLabel>Takes recorded</FieldLabel>
      <div className="flex h-5 items-end gap-1" role="img"
           aria-label={`${usable.length} recordings, lengths ${usable
             .map(t => `${(t.duration_sec as number).toFixed(1)} seconds`)
             .join(", ")}`}
      >
        {usable.map((t, i) => {
          const secs = t.duration_sec as number
          // 20% floor so a very short take is still visible as a bar.
          const pct = Math.max((secs / longest) * 100, 20)
          return (
            <span
              key={i}
              title={`Take ${i + 1}: ${secs.toFixed(1)}s`}
              className="w-1.5 shrink-0 rounded-[2px] bg-aura-forest-light"
              style={{ height: `${Math.max(pct, 18)}%` }}
            />
          )
        })}
      </div>
      <div className="mt-1 text-[11px] tabular-nums text-aura-muted">
        {usable.length} take{usable.length === 1 ? "" : "s"}
      </div>
    </div>
  )
}

/* ---------- Info card ---------- */
function InfoCard({ title, className, children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    /* Sits directly on the canvas, not inside a white card, so it takes the
   full panel treatment. Were it nested, it would revert to a light tile. */
  <div className={cn("aura-panel rounded-2xl py-5 px-6", className)}>
      <h2 className="mb-4 flex items-center gap-2 font-display text-[13px] font-semibold uppercase tracking-[0.04em] text-aura-muted">
        {title}
      </h2>
      {children}
    </div>
  )
}

/* ---------- Result banner ---------- */
  type Severity = "high" | "moderate" | "clear"

  const BANNER_CONFIG: Record<
    Severity,
    { label: string; detail: string; container: string; icon: React.ReactNode; title: string; sub: string }
  > = {
    high: {
    label: "PNEUMONIA SUSPECTED",
    detail: "Flagged · urgent clinical evaluation recommended",
    container: "border-aura-coral/40 border-t-aura-coral bg-aura-coral-soft",
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
    container: "border-aura-mint/50 border-t-aura-pine bg-aura-mint-soft",
    icon: <CheckCircle className="h-6 w-6 text-aura-mint" />,
    title: "text-aura-forest",
    sub: "text-aura-forest",
  },
}

function ResultBanner({ screening }: { screening: ScreeningDetail }) {
  // Banner must reflect the MOST SEVERE finding: Pneumonia > COPD > no findings
    const severity: Severity =
      screening.respiratory_result === "Pneumonia"
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
      className={cn("mb-6 flex items-center gap-3 rounded-2xl border border-t-[3px] p-4 shadow-[0_2px_4px_rgba(15,61,51,0.08),0_16px_32px_-12px_rgba(15,61,51,0.30)] sm:gap-4 sm:p-5", cfg.container)}
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
        <p className={cn("aura-pop-in font-display text-lg font-bold leading-tight tracking-wide text-balance sm:text-xl", cfg.title)}>{cfg.label}</p>
        <p className={cn("mt-1 font-mono text-[11px] uppercase leading-relaxed tracking-[0.14em] sm:text-[13px]", cfg.sub)}>{cfg.detail}</p>
      </div>
    </motion.div>
  )
}

/* ---------- Loading skeleton ---------- */
function ScreeningSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-24 animate-pulse rounded-2xl bg-aura-sage" />
      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
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
            <div className="font-mono text-[13.5px] uppercase tracking-[0.08em] text-aura-muted">{eyebrow}</div>
            <div className="font-display text-[17px] font-semibold text-aura-ink">{name}</div>
          </div>
        </div>
        <TierStatusPill ok={!flagged} label={statusLabel} />
      </div>
      {/* Ring beside the distribution, not above it, at every width.

          This was `sm:grid-cols-[200px_1fr]`, so below 640px it collapsed to
          one column and the phone got a full-width ring with the bars pushed
          below the fold -- the least useful ordering, because the numbers are
          what a clinician reads. A 132px ring plus a 150px track fits inside a
          375px screen, so the two-column layout now starts at the smallest
          breakpoint and only widens the track on larger screens.

          The left column carries the ring and a stack of small labels, so its
          type is stepped down on mobile rather than being allowed to wrap. */}
      <div className="grid grid-cols-[150px_minmax(0,1fr)] gap-3 px-4 py-5 sm:grid-cols-[200px_1fr] sm:gap-8 sm:px-6 sm:py-6">
        <div className="flex flex-col items-start gap-3 sm:items-start sm:gap-4">
          <ConfidenceRing value={confidence ?? 0} flagged={flagged} />
          {modelVersion && (
            <div>
              <FieldLabel>Model Version</FieldLabel>
              <div className="font-mono text-[11px] font-medium text-aura-ink sm:text-[12.5px]">{modelVersion}</div>
            </div>
          )}
          {decisions?.map((d, i) => (
            <div key={i}>
              <FieldLabel>{d.label}</FieldLabel>
              <div className="text-[12px] font-medium leading-snug text-aura-ink sm:text-[13px]">{d.value}</div>
            </div>
          ))}
        </div>
        <div className="max-w-2xl min-w-0">{children}</div>
      </div>
    </div>
  )
}

/* ---------- Probability color helper ---------- */
function tierColor(cls: string): string {
  return cls === "Healthy" ? MINT : CORAL
}

export function ScreeningDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { accessToken } = useAuth()
  const [screening, setScreening] = useState<ScreeningDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /* Probability lists hoisted to the very top of the component — above every
     early return. Calling useMemo inside conditional JSX changed the hook
     count between renders and crashed the page with React error #310
     whenever probabilities were null. */
  const respProbabilityBars = useMemo(() => {
    if (!screening?.respiratory_probabilities) return null
    return Object.entries(screening.respiratory_probabilities).map(([cls, prob]) => (
      <ProbabilityBar key={cls} label={cls} prob={prob} color={tierColor(cls)} />
    ))
  }, [screening?.respiratory_probabilities])

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
      // The list view shows review status; drop its cache so any mounted view
      // (this tab's list, or another tab) shows the reviewed state at once
      // instead of waiting for the TTL or a manual reload.
      invalidate("screenings")
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
      <div className="mx-auto w-full max-w-4xl pb-16">
        <ScreeningSkeleton />
      </div>
    )
  }

  if (!screening || error) {
    return (
      <div className="mx-auto w-full max-w-4xl pb-16">
        <ScreeningError message={error ?? undefined} />
      </div>
    )
  }

  /* Age from the patient's date of birth.

   Returns null rather than a number when there is no usable DOB. It used to
   return whatever `today.getFullYear() - NaN` produced and render it
   unconditionally, which is how a screening with no DOB on the payload
   displayed an age instead of admitting it did not know. The API only began
   returning date_of_birth as part of fixing the anonymous-name bug, so any row
   fetched before that had nothing to compute from. */
  const patientAge = (() => {
    if (!screening.patient_dob) return null
    const birthDate = new Date(screening.patient_dob)
    if (Number.isNaN(birthDate.getTime())) return null
    const today = new Date()
    let age = today.getFullYear() - birthDate.getFullYear()
    const monthDiff = today.getMonth() - birthDate.getMonth()
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--
    }
    return age >= 0 && age < 130 ? age : null
  })()

  /* Tier flagging */
  const respFlagged = screening.respiratory_result !== null && screening.respiratory_result !== "Healthy"

  /* Per-take evidence. Older rows predate per-take scoring and have no
     recording_scores, so the whole section is simply omitted for them. */
  const perTakeRows = screening.recording_scores?.per_clip ?? []
  const overrideTakeIndex =
    typeof screening.recording_scores?.fusion?.override_triggered_by_clip === "number"
      ? screening.recording_scores.fusion.override_triggered_by_clip
      : null

  return (
    <div className="mx-auto w-full max-w-4xl pb-[calc(3rem+env(safe-area-inset-bottom))]">
      {/* Prompt status banner above the title */}
      <ResultBanner screening={screening} />

      {/* Header / topbar */}
      <motion.div initial={reduceMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, ...sectionSpring }} className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-aura-ink">Screening Result</h1>
          <div className="mt-1 flex items-center gap-2 text-[13.5px] text-aura-muted">
            <strong className={cn("font-semibold", !screening.patient_name && "italic text-aura-muted")}>
              {screening.patient_name || "Anonymous Screening"}
            </strong>
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
          {/* Print removed at the owner's request. The PDF download covers the
              same need and produces a consistent clinical document; a print
              dialog produced whatever the browser's default margins happened to
              be, which is not something a screening record should depend on. */}
        </div>
      </motion.div>

      {/* Patient Information

          Age and Gender are separate, and the age bracket is gone. Brackets
          existed to give the model a coarse band; showing "13-21" beside an
          exact "21 years" is redundant. The clinic is dropped for the same
          reason -- there is one clinic, so a field reading "Default Clinic"
          tells a clinician nothing, while the clinician who performed the
          screening does.

          Two columns on a phone, with no column spanning the full width:
          Name and Age share the first row, Gender and Clinician the second.
          Name used to span both columns and Clinician sat alone on a third
          row, which on a 375px screen made the card three rows tall for four
          values and pushed the age below the fold. Nothing here is long enough
          to need the extra width -- the longest is a name, and it truncates. */}
      <motion.div initial={reduceMotion ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12, ...sectionSpring }}>
      <InfoCard title="Patient Information">
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:gap-8 lg:grid-cols-4 lg:gap-6">
          <div className="min-w-0">
            <FieldLabel>Name</FieldLabel>
            <div className={cn("truncate text-[13.5px] font-medium", !screening.patient_name ? "italic text-aura-muted" : "text-aura-ink")}>
              {screening.patient_name || "Anonymous Screening"}
            </div>
          </div>
          <div>
            <FieldLabel>Age</FieldLabel>
            <div className="text-[13.5px] font-medium tabular-nums text-aura-ink">
              {patientAge !== null ? `${patientAge} years` : "—"}
            </div>
          </div>
          <div>
            <FieldLabel>Gender</FieldLabel>
            <div className="text-[13.5px] font-medium capitalize text-aura-ink">
              {screening.patient_gender || "—"}
            </div>
          </div>
          <div>
            <FieldLabel>Clinician</FieldLabel>
            <div className="text-[13.5px] font-medium leading-snug text-aura-ink">
              {screening.clinician_name || "—"}
            </div>
          </div>
        </div>
      </InfoCard>
      </motion.div>
      {/* Screening Details */}
      <motion.div initial={reduceMotion ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18, ...sectionSpring }} className="mt-6">
      <InfoCard title="Screening Details">
        <div className="mb-5 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <FieldLabel>Screening Date</FieldLabel>
            <div className="text-[13.5px] font-medium tabular-nums text-aura-ink">{dateTimeFormat.format(new Date(screening.created_at))}</div>
          </div>
          <div>
            <FieldLabel>Model Version</FieldLabel>
            <div className="font-mono text-[13.5px] font-medium text-aura-ink">{screening.model_version}</div>
          </div>
          <div>
            <FieldLabel>Audio Duration</FieldLabel>
            <div className="text-[13.5px] font-medium text-aura-ink">
              {screening.audio_duration_sec ? `${screening.audio_duration_sec}s` : "N/A"}
            </div>
          </div>
          <div>
            <FieldLabel>Status</FieldLabel>
            <div
              className={cn(
                "inline-flex items-center rounded-full px-3 py-1 font-mono text-[13px] font-semibold",
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
          <div className="flex flex-col items-end min-w-0">
            <TakeDurations takes={screening.recording_scores?.per_clip ?? []} />
          </div>
        </div>
      </InfoCard>
      </motion.div>

      {/* Clinical interpretation — what the verdict means and what to do next.
          Above the classifier card because it is the part a clinician acts on;
          the probability bars below are the evidence for it. */}
      {screening.interpretation_status && screening.confidence_level && (
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.22, ...sectionSpring }}
        >
          <InterpretationPanel
            className="mt-6"
            status={screening.interpretation_status}
            level={screening.confidence_level}
            decisionRule={screening.decision_rule}
            decisionDetail={screening.decision_detail}
            lowAgreement={screening.low_agreement}
            recordingsTotal={screening.recordings_total}
            recordingsFlagged={screening.recordings_flagged}
          />
        </motion.div>
      )}

      {/* Respiratory classifier */}
      <motion.div initial={reduceMotion ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24, ...sectionSpring }}>
      {screening.respiratory_result && (
        <TierCard
          className="mt-6"
          eyebrow="Classification"
          name="Respiratory Classifier"
          flagged={respFlagged}
          statusLabel={screening.respiratory_result || "Healthy"}
          confidence={screening.respiratory_confidence ?? 0}
          modelVersion={screening.model_version}
          decisions={[
            { label: "Outcome", value: "Final Classification" },
            ...(screening.recording_paths?.length
              ? [
                  {
                    label: "Takes fused",
                    value: `${screening.recording_paths.length}`,
                  },
                ]
              : []),
            ...(screening.cascade_path
              ? [
                  {
                    label: "Fusion",
                    value:
                      screening.cascade_path === "mean_then_safety_override"
                        ? "Mean of takes, safety override"
                        : screening.cascade_path,
                  },
                ]
              : []),
          ]}
        >
          {screening.respiratory_probabilities && (
            <div>
              <div className="mb-4 font-mono text-[13.5px] uppercase tracking-[0.08em] text-aura-muted">
                Probability Distribution
              </div>
              {respProbabilityBars}
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
            <div className="bg-aura-surface rounded-lg p-4 mt-5">
              <h3 className="flex items-center gap-2 font-semibold text-aura-forest">
                <AlertCircle className="h-5 w-5" />
                Moderate Priority: COPD Suspected
              </h3>
              <p className="mt-2 text-sm text-aura-ink">Clinical evaluation recommended. Consider spirometry and pulmonology referral.</p>
            </div>
          )}

          {screening.respiratory_result === "Healthy" && (
            <div className="bg-aura-surface rounded-lg p-4 mt-5">
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

      {/* Per-take scores — the evidence behind the headline verdict */}
      {perTakeRows.length > 0 && (
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, ...sectionSpring }}
          className="aura-panel mt-6 rounded-[14px] py-5 px-6"
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-display text-[13px] font-semibold uppercase tracking-[0.04em] text-aura-muted">
              Per-take scores
            </h2>
            {overrideTakeIndex !== null && (
              <span className="rounded-full border border-aura-coral/30 bg-aura-coral-soft px-3 py-1 text-xs font-semibold text-aura-coral">
                Safety override — take {overrideTakeIndex + 1} decided the result
              </span>
            )}
          </div>

          <p className="mb-4 max-w-[70ch] text-sm leading-relaxed text-aura-muted">
            Every take is scored on its own and then averaged. A take that Stage 1
            calls healthy never reaches Stage 2, which is why its Stage 2 column is
            blank.
          </p>

          {/* Mobile: one compact block per take.

              The desktop table below sets a fixed minimum width inside a
              horizontal scroller, so on a 375px screen the Stage 2 column sits
              off the right edge and a clinician sees only Stage 1 -- which is
              the half that is usually blank. Scrolling sideways to read
              per-take evidence is the wrong trade on a phone, so below `md`
              each take becomes a two-line card that fits the width and carries
              all four numbers.

              Both render the same rows from the same source, so they cannot
              disagree. */}
          <ul className="m-0 list-none space-y-2 p-0 md:hidden">
            {perTakeRows.map((c) => (
              <li
                key={c.index}
                className={cn(
                  "rounded-lg border border-aura-border-soft bg-white px-3 py-2.5",
                  c.index === overrideTakeIndex && "border-aura-coral/30 bg-aura-coral-soft/40"
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[13px] font-semibold text-aura-ink">
                    Take {c.index + 1}
                  </span>
                  <span
                    className={cn(
                      "inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold",
                      c.clip_label === "Healthy" && "bg-aura-mint-soft text-aura-pine",
                      c.clip_label === "COPD" && "bg-amber-100 text-amber-800",
                      c.clip_label === "Pneumonia" && "bg-aura-coral-soft text-aura-coral"
                    )}
                  >
                    {c.clip_label}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12px] tabular-nums text-aura-muted">
                  <span>{c.duration_sec.toFixed(1)}s</span>
                  <span>
                    <span className="text-aura-muted/80">S1</span>{" "}
                    <span className="font-medium text-aura-ink">
                      {c.stage1_healthy_prob.toFixed(2)}
                    </span>
                  </span>
                  <span>
                    <span className="text-aura-muted/80">S2</span>{" "}
                    <span className="font-medium text-aura-ink">
                      {c.stage2_pneumonia_prob === null ? "—" : c.stage2_pneumonia_prob.toFixed(2)}
                    </span>
                  </span>
                </div>
              </li>
            ))}
          </ul>

          {/* Desktop: the table. */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-aura-border-soft text-left">
                  <th scope="col" className="py-2 pr-4 font-semibold text-aura-ink">Take</th>
                  <th scope="col" className="py-2 pr-4 font-semibold text-aura-ink">Duration</th>
                  <th scope="col" className="py-2 pr-4 text-right font-semibold text-aura-ink">Stage 1 healthy</th>
                  <th scope="col" className="py-2 pr-4 text-right font-semibold text-aura-ink">Stage 2 pneumonia</th>
                  <th scope="col" className="py-2 font-semibold text-aura-ink">Read</th>
                </tr>
              </thead>
              <tbody>
                {perTakeRows.map((c) => (
                  <tr
                    key={c.index}
                    className={cn(
                      "border-b border-aura-border-soft last:border-0",
                      c.index === overrideTakeIndex && "bg-aura-coral-soft/40"
                    )}
                  >
                    <td className="py-2.5 pr-4 font-medium text-aura-ink">{c.index + 1}</td>
                    <td className="py-2.5 pr-4 tabular-nums text-aura-muted">
                      {c.duration_sec.toFixed(1)}s
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular-nums text-aura-ink">
                      {c.stage1_healthy_prob.toFixed(2)}
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular-nums text-aura-ink">
                      {c.stage2_pneumonia_prob === null
                        ? "—"
                        : c.stage2_pneumonia_prob.toFixed(2)}
                    </td>
                    <td className="py-2.5">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold",
                          c.clip_label === "Healthy" && "bg-aura-mint-soft text-aura-pine",
                          c.clip_label === "COPD" && "bg-amber-100 text-amber-800",
                          c.clip_label === "Pneumonia" && "bg-aura-coral-soft text-aura-coral"
                        )}
                      >
                        {c.clip_label}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {/* Actions */}
      <div className="mt-6 print:hidden">
        <Button variant="outline" onClick={() => navigate("/dashboard/patient-records")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Patient Records
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

