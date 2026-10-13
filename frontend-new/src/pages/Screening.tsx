"use client"

import { useState, useRef, useEffect, useMemo, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { motion, AnimatePresence, useReducedMotion } from "framer-motion"
import { scaleIn } from "@/lib/motion"
import { Loader2, Mic, MicOff, Trash2, CheckCircle, AlertCircle, ChevronRight, Settings, Plus, AlertTriangle, Search } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Input } from "@/components/ui/input"

import { useAuth } from "@/hooks/useAuth"
import { cn } from "@/lib/utils"
import { getApiUrl } from "@/lib/api"
import { useCachedData, invalidate } from "@/hooks/useCachedData"
import { NewPatientModal } from "@/components/NewPatientModal"

/* Capture is stethoscope-only: no camera, no file upload. A clinician records
   between MIN_TAKES and MAX_TAKES separate takes; the batch is scored
   independently and fused by the inference service, which is what makes the
   result steadier than any single take. MIN_TAKES is a hard floor — below it
   there is not enough evidence for a confident read. */
const MIN_TAKES = 3
const MAX_TAKES = 5

type Take = {
  id: string
  url: string
  blob: Blob
  durationSec: number
}

const dobDateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" })

const initialsOf = (name: string) =>
  name
    .split(" ")
    .map(part => part.charAt(0))
    .slice(0, 2)
    .join("")
    .toUpperCase()

const TODAY = new Date()

const ageOf = (dateOfBirth: string) => {
  const birth = new Date(dateOfBirth)
  let age = TODAY.getFullYear() - birth.getFullYear()
  const monthDelta = TODAY.getMonth() - birth.getMonth()
  if (monthDelta < 0 || (monthDelta === 0 && TODAY.getDate() < birth.getDate())) age--
  return age
}

const STATUS_BADGES = {
  completed: { label: "Completed", className: "bg-green-100 text-green-700" },
  awaiting_review: { label: "Awaiting Review", className: "bg-yellow-100 text-yellow-800" },
  retake_needed: { label: "Retake Needed", className: "bg-red-100 text-red-700" },
  none: { label: "New", className: "bg-aura-surface-alt text-aura-muted" },
} as const

type PatientStatusBadge = (typeof STATUS_BADGES)[keyof typeof STATUS_BADGES]

const statusBadgeForLatest = (latest?: { status: string } | null): PatientStatusBadge => {
  if (!latest) return STATUS_BADGES.none
  if (latest.status === "error") return STATUS_BADGES.retake_needed
  if (latest.status === "pending_review") return STATUS_BADGES.awaiting_review
  return STATUS_BADGES.completed
}

const PATIENT_GRID =
  "grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2 sm:grid-cols-[32px_minmax(0,1.1fr)_minmax(0,1.5fr)_122px_76px]"

export function Screening() {
  const { user, accessToken } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState<"patient" | "record" | "result">("patient")
  const [selectedPatient, setSelectedPatient] = useState<{ id: string; name: string } | null>(null)
  const [patientSearch, setPatientSearch] = useState("")
  const reduceMotion = useReducedMotion()
  const [isListOpen] = useState(true)

  /* ── Recording state ──────────────────────────────────────────────────────
     Multiple takes are kept rather than one blob: the inference endpoint takes
     a single clip, so the takes are concatenated at submit time. */
  const [recording, setRecording] = useState(false)
  const [takes, setTakes] = useState<Take[]>([])
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordingStartTimeRef = useRef<number>(0)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Result state
  const [result, setResult] = useState<any>(null)
  const [submitting, setSubmitting] = useState(false)

  /* Object URLs are created per take, so they are tracked together and revoked
     when a take is dropped, the set is cleared, or the component unmounts. */
  const takeUrlsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const urls = takeUrlsRef.current
    return () => {
      for (const url of urls) URL.revokeObjectURL(url)
      urls.clear()
    }
  }, [])

  // Shared cache entries — "screenings" is the SAME payload Dashboard/Screenings use,
  // so the status badges cost zero extra network traffic on back-navigation.
  const patientsFetcher = useCallback(async (): Promise<Array<{ id: string; full_name: string; date_of_birth: string; gender: string }>> => {
    const res = await fetch(getApiUrl("/api/patients"), {
      headers: { Authorization: `Bearer ${accessToken ?? ""}` },
    })
    if (!res.ok) throw new Error("Failed to fetch patients")
    return res.json()
  }, [accessToken])

  const screeningsFetcher = useCallback(async (): Promise<Array<Record<string, unknown>>> => {
    const res = await fetch(getApiUrl("/api/screenings"), {
      headers: { Authorization: `Bearer ${accessToken ?? ""}` },
    })
    if (!res.ok) throw new Error("Failed to fetch screening statuses")
    return res.json()
  }, [accessToken])

  const { data: patientsData, isLoading: loadingPatients, refresh: refreshPatients } = useCachedData(
    user && accessToken ? "patients" : null,
    patientsFetcher,
    { ttlMs: 60_000 },
  )
  const { data: statusData, refresh: refreshStatuses } = useCachedData(
    user && accessToken ? "screenings" : null,
    screeningsFetcher,
  )

  useEffect(() => {
    if (!user) return
    void Promise.all([refreshPatients(), refreshStatuses()])
  }, [user, refreshPatients, refreshStatuses])

  const patients = useMemo(() => patientsData ?? [], [patientsData])

  const latestByPatient = useMemo(() => {
    const latest = new Map<string, { status: string }>()
    for (const s of (statusData ?? []) as Array<{ patient_id: string; status: string }>) {
      if (!latest.has(s.patient_id)) {
        latest.set(s.patient_id, { status: s.status })
      }
    }
    return latest
  }, [statusData])

  const statusBadgeFor = (patientId: string): PatientStatusBadge =>
    statusBadgeForLatest(latestByPatient.get(patientId))

  const patientOptions = useMemo(
    () =>
      patients.map(p => ({
        id: p.id,
        name: p.full_name,
        patientId: p.id.toUpperCase(),
        dob: p.date_of_birth ? dobDateFormat.format(new Date(p.date_of_birth)) : "—",
        age: p.date_of_birth ? ageOf(p.date_of_birth) : null,
        gender: p.gender,
      })),
    [patients],
  )
  const query = patientSearch.trim().toLowerCase()
  const visiblePatients = query
    ? patientOptions.filter(p => p.name.toLowerCase().includes(query))
    : patientOptions

  // --- Patient Selection ---
  const handlePatientSelect = (patient: { id: string; name: string }) => {
    setSelectedPatient(patient)
    setStep("record")
  }

  const [newPatientModalOpen, setNewPatientModalOpen] = useState(false)
  const [savedFormData, setSavedFormData] = useState<any>(null)

  const handleNewPatientCreated = (patient: { id: string; full_name: string }, formData?: any) => {
    setSelectedPatient({ id: patient.id, name: patient.full_name })
    if (formData) setSavedFormData(formData)
    setStep("record")
    setNewPatientModalOpen(false)
  }

  const stepIndex = ["patient", "record", "result"].indexOf(step)

  // --- Audio Recording ---
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      audioChunksRef.current = []

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm"
      mediaRecorderRef.current = new MediaRecorder(stream, { mimeType })

      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }

      mediaRecorderRef.current.onstop = async () => {
        const rawBlob = new Blob(audioChunksRef.current, { type: mimeType })
        const durationSec = (Date.now() - recordingStartTimeRef.current) / 1000
        stream.getTracks().forEach(t => t.stop())

        let blob = rawBlob
        try {
          /* Normalise to WAV here so every take shares one sample rate and
             channel count — concatenating them later requires that. */
          const arrayBuffer = await rawBlob.arrayBuffer()
          const audioCtx = new AudioContext()
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
          await audioCtx.close()
          blob = await encodeWav(audioBuffer)
        } catch (convError) {
          console.error("WAV conversion failed, keeping raw take:", convError)
          toast.error("That take could not be converted to WAV and was not saved.")
          return
        }

        const url = URL.createObjectURL(blob)
        takeUrlsRef.current.add(url)
        setTakes(prev => [
          ...prev,
          { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, url, blob, durationSec },
        ])
      }

      recordingStartTimeRef.current = Date.now()
      mediaRecorderRef.current.start()
      setRecording(true)
    } catch (error) {
      console.error("Recording error:", error)
      toast.error("Could not open the stethoscope input. Check that it is connected and that the browser is allowed to record.")
    }
  }

  async function encodeWav(audioBuffer: AudioBuffer): Promise<Blob> {
    const numChannels = audioBuffer.numberOfChannels
    const sampleRate = audioBuffer.sampleRate
    const bitsPerSample = 16
    const bytesPerSample = bitsPerSample / 8
    const bufferLength = 44 + audioBuffer.length * bytesPerSample * numChannels
    const arrayBuffer = new ArrayBuffer(bufferLength)
    const view = new DataView(arrayBuffer)

    const writeStr = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
    }

    // RIFF header
    writeStr(0, 'RIFF')
    view.setUint32(4, bufferLength - 8, true)
    writeStr(8, 'WAVE')
    // fmt chunk
    writeStr(12, 'fmt ')
    view.setUint32(16, 16, true)  // chunk size
    view.setUint16(20, 1, true)   // audio format (PCM)
    view.setUint16(22, numChannels, true)  // channels
    view.setUint32(24, sampleRate, true)   // sample rate
    view.setUint32(28, sampleRate * numChannels * bytesPerSample, true)  // byte rate
    view.setUint16(32, numChannels * bytesPerSample, true)  // block align
    view.setUint16(34, bitsPerSample, true)  // bits per sample
    // data chunk
    writeStr(36, 'data')
    view.setUint32(40, audioBuffer.length * bytesPerSample * numChannels, true)  // data size

    // Interleave channels if stereo, or just use channel 0 if mono
    const samples = audioBuffer.length
    const dataOffset = 44
    let offset = dataOffset

    if (numChannels === 1) {
      // Mono: just use channel 0 data
      const channel0 = audioBuffer.getChannelData(0)
      for (let i = 0; i < samples; i++) {
        const s = Math.max(-1, Math.min(1, channel0[i]))
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
        offset += 2
      }
    } else {
      // Stereo: interleave L and R
      const channel0 = audioBuffer.getChannelData(0)
      const channel1 = audioBuffer.getChannelData(1)
      for (let i = 0; i < samples; i++) {
        const s0 = Math.max(-1, Math.min(1, channel0[i]))
        const s1 = Math.max(-1, Math.min(1, channel1[i]))
        view.setInt16(offset, s0 < 0 ? s0 * 0x8000 : s0 * 0x7FFF, true)
        offset += 2
        view.setInt16(offset, s1 < 0 ? s1 * 0x8000 : s1 * 0x7FFF, true)
        offset += 2
      }
    }

    return new Blob([arrayBuffer], { type: "audio/wav" })
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop()
    }
    setRecording(false)
  }

  /** Drop one take and release its object URL. */
  const removeTake = (id: string) => {
    setTakes(prev => {
      const target = prev.find(t => t.id === id)
      if (target) {
        URL.revokeObjectURL(target.url)
        takeUrlsRef.current.delete(target.url)
      }
      return prev.filter(t => t.id !== id)
    })
  }

  const clearTakes = () => {
    for (const take of takes) {
      URL.revokeObjectURL(take.url)
      takeUrlsRef.current.delete(take.url)
    }
    setTakes([])
    audioChunksRef.current = []
  }

  const atMaxTakes = takes.length >= MAX_TAKES
  const totalRecordedSec = takes.reduce((sum, t) => sum + t.durationSec, 0)
  const hasEnoughTakes = takes.length >= MIN_TAKES

  // Cleanup object URLs on unmount

  // --- Submit for Analysis ---
  const submitForAnalysis = async () => {
    if (takes.length < MIN_TAKES || !selectedPatient || !accessToken) return

    setSubmitting(true)
    abortControllerRef.current = new AbortController()

    try {
      // Step 1: upload every take as its own file. They are deliberately NOT
      // concatenated: the inference service scores each take separately and
      // then fuses the per-take verdicts, so merging them here would destroy
      // the per-take evidence the fusion step depends on.
      const uploadFormData = new FormData()
      takes.forEach((take, i) => {
        uploadFormData.append("audios", take.blob, `take-${i + 1}.wav`)
      })

      const uploadResponse = await fetch(getApiUrl("/api/audio/upload"), {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: uploadFormData,
        signal: abortControllerRef.current.signal,
      })

      if (!uploadResponse.ok) {
        const error = await uploadResponse.json()
        throw new Error(error.detail || "Audio upload failed")
      }

      const { file_paths } = await uploadResponse.json()

      // Step 2: Create screening via backend (handles inference + DB save)
      const screeningResponse = await fetch(getApiUrl("/api/screenings"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          patient_id: selectedPatient.id,
          audio_file_paths: file_paths,
          audio_duration_sec: Math.round(totalRecordedSec * 100) / 100 || undefined,
        }),
        signal: abortControllerRef.current.signal,
      })

      if (!screeningResponse.ok) {
        const error = await screeningResponse.json()
        throw new Error(error.detail || "Screening creation failed")
      }

      const screening = await screeningResponse.json()

      // Create result object for display
      setResult({
        respiratory_result: screening.respiratory_result ? { label: screening.respiratory_result, confidence: screening.respiratory_confidence, probabilities: screening.respiratory_probabilities } : null,
        cascade: screening.cascade_path,
        model_version: screening.model_version,
        screening_id: screening.id,
        patient_name: selectedPatient.name,
        timestamp: screening.created_at,
      })

      // New screening exists now - drop cached lists so all views refetch fresh
      invalidate("screenings")
      setStep("result")
    } catch (error: any) {
      if (error.name === "AbortError") {
        toast.error("Analysis cancelled")
      } else {
        console.error("Analysis error:", error)
        toast.error("Analysis failed: " + (error instanceof Error ? error.message : "Unknown error"))
      }
    } finally {
      setSubmitting(false)
      abortControllerRef.current = null
    }
  }
  const getRespBadge = (label: string | null) => {
    if (!label) return <Badge variant="secondary">N/A</Badge>
    const variants: Record<string, "default" | "success" | "warning" | "destructive"> = {
      Healthy: "success",
      Pneumonia: "destructive",
      COPD: "warning",
    }
    return <Badge variant={variants[label] || "default"}>{label}</Badge>
  }

  const handleNewScreening = () => {
    clearTakes()
    setSelectedPatient(null)
    setResult(null)
    setStep("patient")
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      {/* Signal chain — the three steps read as one connected acquisition
          path rather than three detached dots. The connector fills as each
          stage is reached. */}
      <nav aria-label="Screening progress" className="px-2">
        <ol className="relative flex items-start justify-center">
          {/* Baseline rail sits behind the nodes. */}
          <span
            aria-hidden="true"
            className="absolute left-[16.67%] right-[16.67%] top-[18px] h-[2px] rounded-full bg-aura-border-soft"
          />
          <motion.span
            aria-hidden="true"
            className="absolute left-[16.67%] top-[18px] h-[2px] origin-left rounded-full bg-aura-forest"
            initial={false}
            animate={{ width: `${(stepIndex / 2) * 66.66}%` }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.45, ease: "easeOut" }}
          />

          {["patient", "record", "result"].map((s, i) => {
            const isComplete = stepIndex > i
            const isActive = step === s
            return (
              <li
                key={s}
                className="relative z-10 flex w-1/3 flex-col items-center"
                aria-current={isActive ? "step" : undefined}
              >
                {/* Completed steps are real buttons — clinicians can go back
                    a step without losing entered data, but cannot skip
                    forward past an unfinished step. */}
                <button
                  type="button"
                  disabled={!isComplete}
                  onClick={() => isComplete && setStep(s as typeof step)}
                  aria-label={isComplete ? `Go back to step ${i + 1}: ${s}` : `Step ${i + 1}: ${s}`}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-brand focus-visible:ring-offset-2",
                    isActive && "border-aura-pine bg-aura-pine text-white ring-4 ring-aura-pine/20",
                    isComplete && "cursor-pointer border-aura-pine bg-aura-pine text-white hover:brightness-110 active:scale-95",
                    !isActive && !isComplete && "border-aura-border-soft bg-white text-aura-muted",
                  )}
                >
                  {isComplete ? <CheckCircle className="h-5 w-5" aria-hidden="true" /> : i + 1}
                </button>
                <span
                  className={cn(
                    "mt-2 text-center text-xs font-medium",
                    isActive ? "font-semibold text-aura-forest" : "text-aura-muted",
                  )}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </span>
              </li>
            )
          })}
        </ol>
      </nav>

      {/* Step 1: Patient Selection */}
      <AnimatePresence mode="wait">
        {step === "patient" && (
          <motion.div key="patient" variants={scaleIn} initial="hidden" animate="visible" exit="exit">
            <Card className="aura-panel overflow-hidden rounded-2xl">
              {loadingPatients ? (
                <div role="status" aria-live="polite" aria-label="Loading patients" className="divide-y divide-aura-border-soft">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className={cn(PATIENT_GRID, "py-3")}>
                      <span className="block h-8 w-8 shrink-0 animate-pulse rounded-full bg-aura-surface-alt" />
                      <span className="flex min-w-0 flex-col gap-1.5">
                        <span className="block h-4 w-32 animate-pulse rounded bg-aura-surface-alt" />
                        <span className="block h-3 w-20 animate-pulse rounded bg-aura-surface-alt" />
                      </span>
                      <span className="hidden h-5 w-16 animate-pulse rounded-full bg-aura-surface-alt sm:block" />
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  {/* Header: title left, search right */}
                  <div className="flex flex-col gap-3 border-b border-aura-border-soft px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                    <div>
                      <CardTitle className="text-xl">Select Patient</CardTitle>
                      <CardDescription className="mt-1">Choose an existing patient or create a new screening</CardDescription>
                    </div>
                    {patientOptions.length > 0 && (
                      <div className="relative w-full sm:w-80">
                        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-aura-muted" />
                        <Input
                          type="search"
                          value={patientSearch}
                          onChange={e => setPatientSearch(e.target.value)}
                          placeholder="Search patients by name→·"
                          aria-label="Search patients by name"
                          autoComplete="off"
                          className="h-9 rounded-lg border-aura-border pl-9 text-sm"
                        />
                      </div>
                    )}
                  </div>

                  {patientOptions.length === 0 ? (
                    <CardContent>
                      <div className="py-8 text-center">
                        <p className="mb-4 text-aura-muted">No patients found. Create a screening for a new patient.</p>
                        <Button onClick={() => setNewPatientModalOpen(true)} size="lg">
                          <Plus className="mr-2 h-4 w-4" />
                          New Patient Screening
                        </Button>
                      </div>
                    </CardContent>
                  ) : (
                    <>
                      <AnimatePresence initial={false}>
                        {isListOpen && (
                          <motion.div
                            key="patient-list"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.25, ease: "easeInOut" }}
                            className="overflow-hidden"
                          >
                            <CardContent className="p-0 pb-3">
                              {visiblePatients.length === 0 && (
                                <p role="status" className="px-4 py-10 text-center text-sm text-aura-muted">
                                  No patients match &ldquo;{patientSearch}&rdquo;.
                                </p>
                              )}
                              {visiblePatients.length > 0 && (
                                <div>
                                  {/* Column labels (decorative; rows are self-describing buttons) */}
                                  <div
                                    aria-hidden="true"
                                    className={cn(PATIENT_GRID, "hidden border-b border-aura-border-soft bg-aura-surface-alt pb-2 pt-3 text-xs font-medium text-aura-muted sm:grid")}
                                  >
                                    <span />
                                    <span>Patient</span>
                                    <span>Details</span>
                                    <span>Status</span>
                                    <span className="text-right">Action</span>
                                  </div>
                                  {visiblePatients.map(patient => {
                                    const isSelected = selectedPatient?.id === patient.id
                                    const badge = statusBadgeFor(patient.id)
                                    return (
                                      <button
                                        key={patient.id}
                                        type="button"
                                        aria-label={`Start screening for ${patient.name}`}
                                        aria-pressed={isSelected}
                                        onClick={() => handlePatientSelect({ id: patient.id, name: patient.name })}
                                        className={cn(
                                          PATIENT_GRID,
                                          "group w-full border-b border-aura-border-soft text-left transition-colors last:border-b-0",
                                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                                          "active:scale-[0.995]",
                                          isSelected
                                            ? "bg-green-50 ring-1 ring-inset ring-green-600"
                                            : "bg-aura-elevated hover:bg-aura-surface-alt"
                                        )}
                                      >
                                        <span
                                          aria-hidden="true"
                                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-aura-mint-soft text-xs font-semibold text-aura-forest"
                                        >
                                          {initialsOf(patient.name)}
                                        </span>
                                        <span className="flex min-w-0 flex-col gap-0.5">
                                          <span className="flex min-w-0 items-center gap-2">
                                            <span className="truncate text-sm font-medium">{patient.name}</span>
                                            {isSelected && (
                                              <span className="inline-flex shrink-0 items-center rounded-full border border-green-600 px-1.5 text-[13.5px] font-semibold leading-4 text-green-700">
                                                SELECTED
                                              </span>
                                            )}
                                          </span>
                                          {/* Item 2: raw DB UUID removed from the picker —
                                              DOB/age/sex in the next column identify the patient;
                                              the full ID lives on Patient Detail only. */}
                                        </span>
                                        <span className="hidden min-w-0 truncate text-xs text-aura-muted sm:block">
                                          {patient.dob} &middot; {patient.age !== null ? `${patient.age} yrs` : "—"} &middot;{" "}
                                          <span className="capitalize">{patient.gender}</span>
                                        </span>
                                        <span className="hidden sm:block">
                                          <span
                                            className={cn(
                                              "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
                                              badge.className
                                            )}
                                          >
                                            {badge.label}
                                          </span>
                                        </span>
                                        <span className="flex items-center justify-end gap-1.5">
                                          <span
                                            className={cn(
                                              "hidden text-xs font-semibold lg:inline",
                                              isSelected ? "text-green-700" : "text-aura-muted group-hover:text-green-700"
                                            )}
                                          >
                                            {isSelected ? "Selected" : "Select"}
                                          </span>
                                          <ChevronRight
                                            aria-hidden="true"
                                            className="h-4 w-4 shrink-0 text-aura-muted transition-transform group-hover:translate-x-0.5"
                                          />
                                        </span>
                                      </button>
                                    )
                                  })}
                                </div>
                              )}
                            </CardContent>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Pinned footer action */}
                      <div className="border-t border-aura-border-soft p-3">
                        {/* Item 6 decision: all page-level "create new [X]" actions use the
                            solid primary style; dashed-outline stays reserved for inline/
                            empty-state add actions. This is a page-level create action. */}
                        <Button
                          type="button"
                          onClick={() => setNewPatientModalOpen(true)}
                          className="w-full gap-2"
                        >
                          <Plus className="h-4 w-4" aria-hidden="true" />
                          New Patient
                        </Button>
                      </div>
                    </>
                  )}
                </>
              )}
            </Card>
      </motion.div>
    )}
  </AnimatePresence>

      <NewPatientModal
        open={newPatientModalOpen}
        onOpenChange={(open) => {
          setNewPatientModalOpen(open)
          if (!open && savedFormData) setSavedFormData(null)
        }}
        onPatientCreated={handleNewPatientCreated}
        initialData={savedFormData}
      />

      {/* Step 2: Audio Recording */}
      <AnimatePresence mode="wait">
        {step === "record" && (
          <motion.div key="record" variants={scaleIn} initial="hidden" animate="visible" exit="exit">
            <Card className="aura-panel rounded-2xl">
              <CardHeader>
                <CardTitle>Record Breathing Audio</CardTitle>
            <CardDescription>Patient: {selectedPatient?.name}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              {/* Progress toward the required minimum, stated plainly so the
                  clinician can see when the screening is ready to run. */}
              <div className="rounded-lg border border-aura-border-soft bg-aura-surface-alt p-4">
                <h3 className="text-lg font-medium">Digital Stethoscope Recording</h3>
                <p className="mt-1 text-sm text-aura-muted">
                  Record {MIN_TAKES} to {MAX_TAKES} takes. Each take is scored separately and the
                  results are fused, so recording more than {MIN_TAKES} usually gives a steadier read
                  {takes.length > 0
                    ? ` — you have ${takes.length} of ${MIN_TAKES} needed.`
                    : "."}
                </p>
              </div>

              {!recording && (
                <Button
                  onClick={startRecording}
                  size="lg"
                  disabled={atMaxTakes}
                  className="w-full gap-3"
                >
                  <Mic className="h-5 w-5" />
                  {takes.length === 0 ? "Start First Recording" : "Record Another Take"}
                </Button>
              )}
              {atMaxTakes && !recording && (
                <p className="text-center text-sm text-aura-muted">
                  Maximum of {MAX_TAKES} takes reached. Remove one to record a replacement.
                </p>
              )}
              {recording && (
                <>
                  {/* Live listening equalizer — animates only while recording */}
                  <div
                    className="flex h-12 items-end justify-center gap-1.5 rounded-lg border border-aura-border-soft bg-aura-surface-alt px-6 py-2"
                    role="status"
                    aria-label="Recording in progress"
                  >
                    {[0.9, 0.5, 1.1, 0.7, 1.3, 0.6, 1.0, 0.8, 1.2, 0.5, 0.95, 0.65].map((delay, i) => (
                      <motion.span
                        key={i}
                        aria-hidden="true"
                        className="w-1.5 rounded-full bg-aura-coral"
                        animate={
                          reduceMotion
                            ? { height: "40%" }
                            : { height: ["30%", "95%", "45%", "80%", "30%"] }
                        }
                        transition={
                          reduceMotion
                            ? { duration: 0 }
                            : { duration: 0.9 + delay * 0.3, repeat: Infinity, ease: "easeInOut", delay }
                        }
                        style={{ height: "40%" }}
                      />
                    ))}
                  </div>
                  <Button
                    onClick={stopRecording}
                    size="lg"
                    variant="destructive"
                    className="w-full gap-3"
                  >
                    <MicOff className="h-5 w-5" />
                    Stop Recording
                  </Button>
                </>
              )}

              {/* Recorded takes — each one is playable and individually removable */}
              {takes.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-aura-ink">
                      Recorded takes
                      <span className="ml-2 font-normal text-aura-muted">
                        {totalRecordedSec.toFixed(1)}s total
                      </span>
                    </p>
                    <Button variant="ghost" size="sm" onClick={clearTakes} className="text-aura-muted hover:text-aura-coral-strong">
                      <Trash2 className="mr-2 h-4 w-4" />
                      Clear all
                    </Button>
                  </div>
                  <ul className="space-y-2">
                    {takes.map((take, index) => (
                      <li
                        key={take.id}
                        className="flex flex-col gap-3 rounded-lg border border-aura-border-soft bg-aura-surface-alt p-4 sm:flex-row sm:items-center"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <span
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-aura-forest/10 text-sm font-bold tabular-nums text-aura-forest"
                            aria-hidden="true"
                          >
                            {index + 1}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-aura-ink">
                              Take {index + 1}
                              <span className="ml-2 font-normal text-aura-muted">
                                {take.durationSec.toFixed(1)}s
                              </span>
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <audio controls src={take.url} className="h-9 min-w-0 flex-1" aria-label={`Take ${index + 1} playback`} />
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeTake(take.id)}
                            className="touch-target h-9 w-9 shrink-0 rounded-full text-aura-muted hover:bg-aura-coral-soft hover:text-aura-coral-strong"
                            aria-label={`Remove take ${index + 1}`}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Submit — gated on the minimum take count. */}
            <div className="space-y-2">
              <Button
                onClick={submitForAnalysis}
                disabled={submitting || !hasEnoughTakes}
                size="lg"
                className="w-full gap-2"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" role="status" aria-live="polite" />
                    Analyzing {takes.length} takes…
                  </>
                ) : (
                  <>
                    <Settings className="h-5 w-5" />
                    {hasEnoughTakes
                      ? `Run Analysis on ${takes.length} Takes`
                      : `Record ${MIN_TAKES - takes.length} More Take${MIN_TAKES - takes.length === 1 ? "" : "s"}`}
                  </>
                )}
              </Button>
              {!hasEnoughTakes && takes.length > 0 && (
                <p className="text-center text-sm text-aura-muted">
                  {MIN_TAKES - takes.length} more take{MIN_TAKES - takes.length === 1 ? "" : "s"} needed
                  before analysis can run.
                </p>
              )}
            </div>
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button variant="ghost" onClick={() => {
              if (savedFormData) {
                setNewPatientModalOpen(true)
              }
              setStep("patient")
            }}>
              Back to patient selection
            </Button>
          </CardFooter>
        </Card>
      </motion.div>
    )}
  </AnimatePresence>

      {/* Step 3: Results */}
      <AnimatePresence mode="wait">
        {step === "result" && result && (
          <motion.div key="result" variants={scaleIn} initial="hidden" animate="visible" exit="exit">
            <Card className="aura-panel rounded-2xl">
              <CardHeader>
                <CardTitle>Screening Result</CardTitle>
            <CardDescription>
              Patient: {result.patient_name} - {new Date(result.timestamp).toLocaleString()}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Respiratory Result */}
            {result.respiratory_result && (
              <div className="p-4 bg-aura-surface-alt rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold">Respiratory Classifier</h3>
                  {getRespBadge(result.respiratory_result.label)}
                </div>
                <div className="text-sm">
                  <p className="text-aura-muted">Confidence</p>
                  <p className="font-mono text-lg">{(result.respiratory_result.confidence * 100).toFixed(1)}%</p>
                </div>
                <div className="mt-4">
                  <p className="text-sm text-aura-muted mb-2">Probability Distribution</p>
                  <div className="space-y-2">
                    {Object.entries((result.respiratory_result.probabilities as Record<string, number>) || {}).map(([cls, prob]) => (
                      <div key={cls} className="flex items-center justify-between text-sm">
                        <span className={cn("font-medium", cls === "Pneumonia" ? "text-destructive" : cls === "COPD" ? "text-aura-warning" : "text-aura-accent-dark")}>{cls}</span>
                        <div className="flex items-center gap-2 w-full max-w-xs">
                          <Progress value={(prob * 100)} className="h-2 flex-1" />
                          <span className="font-mono w-16 text-right">{(prob * 100).toFixed(1)}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

{/* Facial Cough Detection */}
            {result.cameraData && (
              <div className="p-4 bg-aura-surface-alt rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold">Facial Cough Detection</h3>
                  {result.cameraData.coughDetected ? (
                    <Badge variant="warning">
                      <AlertTriangle className="mr-1 h-3 w-3" />
                      Cough Detected
                    </Badge>
                  ) : (
                    <Badge variant="secondary">
                      <CheckCircle className="mr-1 h-3 w-3" />
                      No Cough Detected
                    </Badge>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
                  <div>
                    <p className="text-aura-muted">Fused Coughs</p>
                    <p className="font-mono text-lg">{result.cameraData.coughCount}</p>
                  </div>
                  <div>
                    <p className="text-aura-muted">Mouth Openings</p>
                    <p className="font-mono text-lg">{result.cameraData.mouthOpenings}</p>
                  </div>
                  <div>
                    <p className="text-aura-muted">Max Mouth Distance</p>
                    <p className="font-mono text-lg">
                      {result.cameraData.maxMouthDistance != null
                        ? result.cameraData.maxMouthDistance.toFixed(3)
                        : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-aura-muted">Audio Confidence</p>
                    <p className="font-mono text-lg">
                      {result.cameraData.audioConfidence != null
                        ? `${(result.cameraData.audioConfidence * 100).toFixed(0)}%`
                        : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-aura-muted">Face Tracked</p>
                    <p className="font-mono text-lg">{result.cameraData.faceTracked ? "Yes" : "No"}</p>
                  </div>
                  <div>
                    <p className="text-aura-muted">Temporal Sync</p>
                    <p className="font-mono text-lg">
                      {result.cameraData.temporalSyncMs != null
                        ? `${result.cameraData.temporalSyncMs}ms`
                        : "—"}
                    </p>
                  </div>
                </div>
              </div>
            )}

{/* Clinical Recommendation */}
            {result.respiratory_result?.label === "Pneumonia" ? (
              <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
                <h4 className="font-semibold text-destructive flex items-center gap-2">
                  <AlertCircle className="h-5 w-5" />
                  High Priority: Pneumonia Suspected
                </h4>
                <p className="mt-2 text-sm">Urgent clinical evaluation recommended. Consider chest imaging and antibiotics per guidelines.</p>
              </div>
            ) : result.respiratory_result?.label === "COPD" ? (
              <div className="p-4 bg-aura-warning-soft/60 border border-aura-warning-border rounded-lg">
                <h4 className="font-semibold text-aura-warning-strong flex items-center gap-2">
                  <AlertCircle className="h-5 w-5" />
                  Moderate Priority: COPD Suspected
                </h4>
                <p className="mt-2 text-sm">Clinical evaluation recommended. Consider spirometry and pulmonology referral.</p>
              </div>
            ) : (
              <div className="p-4 bg-aura-accent-soft border border-aura-border-soft rounded-lg">
                <h4 className="flex items-center gap-2 font-semibold text-aura-pine">
                  <CheckCircle className="h-5 w-5" />
                  Low Priority: Healthy / No Acute Findings
                </h4>
                <p className="mt-2 text-sm">No urgent action required. Routine follow-up as clinically indicated.</p>
              </div>
            )}

            <div className="text-xs text-aura-muted">
              Model version: {result.model_version} &bull; Screening ID: {result.screening_id}
            </div>
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button variant="outline" onClick={handleNewScreening}>
              New Screening
            </Button>
            <Button onClick={() => navigate("/dashboard")}>
              View Dashboard
            </Button>
          </CardFooter>
        </Card>
      </motion.div>
    )}
  </AnimatePresence>
    </div>
  )
}
