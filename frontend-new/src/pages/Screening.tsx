"use client"

import { Fragment, useState, useRef, useEffect, useMemo, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { motion, AnimatePresence, useReducedMotion } from "framer-motion"
import { scaleIn } from "@/lib/motion"
import { Loader2, Mic, MicOff, FileAudio, Trash2, Upload, X, CheckCircle, AlertCircle, ArrowRight, ChevronRight, Settings, Plus, AlertTriangle, Search } from "lucide-react"
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
import { CameraCoughDetection, type CameraCoughSummary } from "@/components/CameraCoughDetection"

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
  urgent: { label: "Urgent", className: "bg-red-100 text-red-700" },
  awaiting_review: { label: "Awaiting Review", className: "bg-yellow-100 text-yellow-800" },
  retake_needed: { label: "Retake Needed", className: "bg-red-100 text-red-700" },
  none: { label: "New", className: "bg-aura-surface-alt text-aura-muted" },
} as const

type PatientStatusBadge = (typeof STATUS_BADGES)[keyof typeof STATUS_BADGES]

const statusBadgeForLatest = (latest?: { status: string; tb_result: string } | null): PatientStatusBadge => {
  if (!latest) return STATUS_BADGES.none
  if (latest.status === "error") return STATUS_BADGES.retake_needed
  if (latest.tb_result === "TB") return STATUS_BADGES.urgent
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

  // Recording state
  const [recording, setRecording] = useState(false)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordingStartTimeRef = useRef<number>(0)
  const audioDurationRef = useRef<number>(0)
  // Track object URLs for cleanup
  const objectUrlRef = useRef<string | null>(null)

  // Upload state
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Result state
  const [result, setResult] = useState<any>(null)
  const [submitting, setSubmitting] = useState(false)

  // Camera / facial aura-detection state (Step 2 -> Step 3)
  const [cameraSummary, setCameraSummary] = useState<CameraCoughSummary | null>(null)
  const cameraDataRef = useRef<CameraCoughSummary | null>(null)

  const handleCameraSummaryChange = (summary: CameraCoughSummary | null) => {
    setCameraSummary(summary)
    // Track the latest summary (including null when the camera stops) so a
    // retake or a different patient never inherits stale facial data.
    cameraDataRef.current = summary
  }


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
    const latest = new Map<string, { status: string; tb_result: string }>()
    for (const s of (statusData ?? []) as Array<{ patient_id: string; status: string; tb_result: string }>) {
      if (!latest.has(s.patient_id)) {
        latest.set(s.patient_id, { status: s.status, tb_result: s.tb_result })
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
        audioDurationRef.current = (Date.now() - recordingStartTimeRef.current) / 1000
        stream.getTracks().forEach(t => t.stop())

        try {
          if (objectUrlRef.current) {
            URL.revokeObjectURL(objectUrlRef.current)
          }
          const arrayBuffer = await rawBlob.arrayBuffer()
          const audioCtx = new AudioContext()
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
          await audioCtx.close()

          const wavBlob = await encodeWav(audioBuffer)
          const url = URL.createObjectURL(wavBlob)
          objectUrlRef.current = url
          setAudioBlob(wavBlob)
          setAudioUrl(url)
        } catch (convError) {
          console.error("WAV conversion error, falling back to raw blob:", convError)
          const url = URL.createObjectURL(rawBlob)
          objectUrlRef.current = url
          setAudioBlob(rawBlob)
          setAudioUrl(url)
        }
      }

      recordingStartTimeRef.current = Date.now()
      mediaRecorderRef.current.start()
      setRecording(true)
    } catch (error) {
      console.error("Recording error:", error)
      toast.error("Could not access microphone. Please check permissions.")
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

  const clearRecording = () => {
    // Clean up object URLs to prevent memory leaks
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
    setAudioBlob(null)
    setAudioUrl(null)
    setUploadedFile(null)
    audioChunksRef.current = []
    // Drop the facial summary so a retake starts from a clean slate and no
    // stale cough data leaks into the next submission.
    setCameraSummary(null)
    cameraDataRef.current = null
  }

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
      }
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl)
      }
    }
  }, [])

  // --- File Upload ---
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type and extension
    const validTypes = ["audio/wav", "audio/wave"]
    const validExtensions = [".wav", ".mp3", ".flac", ".ogg", ".m4a"]
    const hasValidType = validTypes.includes(file.type)
    const hasValidExt = validExtensions.some(ext => file.name.toLowerCase().endsWith(ext))

    if (!hasValidType && !hasValidExt) {
      toast.error("Unsupported file type. Please upload a WAV, MP3, FLAC, OGG, or M4A file.")
      return
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1000) {
      toast.error("File too large. Maximum size is 5MB.")
      return
    }

    // Clean up previous URL
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
    }

    const url = URL.createObjectURL(file)
    objectUrlRef.current = url
    setUploadedFile(file)
    setAudioBlob(file)
    setAudioUrl(url)

    const audio = new Audio()
    audio.src = url
    audio.onloadedmetadata = () => {
      audioDurationRef.current = audio.duration
      // Don't revoke - we're using the URL for playback
    }
  }

  // --- Submit for Analysis ---
  const submitForAnalysis = async () => {
    if (!audioBlob || !selectedPatient || !accessToken) return

    setSubmitting(true)
    abortControllerRef.current = new AbortController()

    try {
      // Step 1: Upload audio file to backend
      const uploadFormData = new FormData()
      uploadFormData.append("audio", audioBlob, "recording.wav")

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

      const { file_path } = await uploadResponse.json()

      // Step 2: Create screening via backend (handles inference + DB save)
      const screeningResponse = await fetch(getApiUrl("/api/screenings"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          patient_id: selectedPatient.id,
          audio_file_path: file_path,
          audio_duration_sec: Math.round(audioDurationRef.current * 100) / 100 || undefined,
          camera_data: cameraDataRef.current,
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
        tb_result: { label: screening.tb_result, confidence: screening.tb_confidence, probabilities: screening.tb_probabilities },
        respiratory_result: screening.respiratory_result ? { label: screening.respiratory_result, confidence: screening.respiratory_confidence, probabilities: screening.respiratory_probabilities } : null,
        cascade: screening.cascade_path,
        model_version: screening.model_version,
        screening_id: screening.id,
        patient_name: selectedPatient.name,
        timestamp: screening.created_at,
        cameraData: cameraDataRef.current,
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

  const getTbBadge = (label: string) => (
    <Badge variant={label === "TB" ? "destructive" : "success"}>
      {label === "TB" && <AlertCircle className="mr-1 h-3 w-3" />}
      {label === "Non-TB" && <CheckCircle className="mr-1 h-3 w-3" />}
      {label}
    </Badge>
  )

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
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
    setSelectedPatient(null)
    setAudioBlob(null)
    setAudioUrl(null)
    setUploadedFile(null)
    setResult(null)
    setCameraSummary(null)
    cameraDataRef.current = null
    setStep("patient")
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      {/* Progress Steps */}
      <nav aria-label="Screening progress" className="flex items-start justify-center">
        {["patient", "record", "result"].map((s, i) => {
          const stepIndex = ["patient", "record", "result"].indexOf(step)
          const isComplete = stepIndex > i
          const isActive = step === s
          return (
          <Fragment key={s}>
            {i > 0 && (
              <span
                aria-hidden="true"
                className="mt-[9px] flex h-5 w-14 items-center sm:w-24"
              >
                <span className="relative h-[2px] flex-1 overflow-hidden rounded-full bg-aura-border">
                  <motion.span
                    className="absolute inset-y-0 left-0 rounded-full bg-aura-accent-dark"
                    initial={false}
                    animate={{ width: stepIndex >= i ? "100%" : "0%" }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                  />
                </span>
                <ArrowRight
                  className={cn(
                    "ml-0.5 h-5 w-5 shrink-0",
                    stepIndex >= i ? "text-aura-accent-dark" : "text-gray-400"
                  )}
                  strokeWidth={2.5}
                />
              </span>
            )}
            <div className="flex w-16 flex-col items-center" aria-current={isActive ? "step" : undefined}>
              <div
                className={cn(
                  "relative flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors",
                  isActive && "border-[#0E7A55] bg-[#0E7A55] text-white ring-4 ring-[#0E7A55]/15",
                  isComplete && "border-aura-accent-dark bg-aura-accent-dark text-white",
                  !isActive && !isComplete && "border-aura-border-soft bg-white text-gray-600"
                )}
              >
                {/* Glowing pulse on the active step */}
                {isActive && !reduceMotion && (
                  <motion.span
                    aria-hidden="true"
                    className="absolute inset-0 rounded-full border-2 border-[#0E7A55]"
                    animate={{ scale: [1, 1.45], opacity: [0.55, 0] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
                  />
                )}
                {isComplete ? <CheckCircle className="h-5 w-5" aria-hidden="true" /> : i + 1}
              </div>
                <span className={cn("mt-1.5 text-xs font-medium", isActive ? "font-semibold text-aura-forest" : "text-gray-600")}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </span>
            </div>
          </Fragment>
          )
        })}
      </nav>

      {/* Step 1: Patient Selection */}
      <AnimatePresence mode="wait">
        {step === "patient" && (
          <motion.div key="patient" variants={scaleIn} initial="hidden" animate="visible" exit="exit">
            <Card className="overflow-hidden">
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
                          placeholder="Search patients by name…"
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
                                              <span className="inline-flex shrink-0 items-center rounded-full border border-green-600 px-1.5 text-[10px] font-semibold leading-4 text-green-700">
                                                SELECTED
                                              </span>
                                            )}
                                          </span>
                                          <span className="truncate text-xs text-aura-muted">{patient.patientId}</span>
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
                        <button
                          type="button"
                          onClick={() => setNewPatientModalOpen(true)}
                          className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-green-600 bg-transparent px-3 py-2 text-sm font-semibold text-green-700 transition-colors hover:bg-green-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.99]"
                        >
                          <Plus className="h-4 w-4" aria-hidden="true" />
                          New Patient
                        </button>
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
            <Card>
              <CardHeader>
                <CardTitle>Record or Upload Cough Audio</CardTitle>
            <CardDescription>Patient: {selectedPatient?.name}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Recording Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Microphone Recording</h3>
              {!audioBlob && !recording && (
                <Button
                  onClick={startRecording}
                  size="lg"
                  className="w-full gap-3"
                >
                  <Mic className="h-5 w-5" />
                  Start Recording
                </Button>
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
              {audioBlob && (
                <div className="flex flex-col items-center gap-4 p-4 bg-aura-surface-alt rounded-lg sm:flex-row">
                  <div className="flex-1">
                    <audio controls src={audioUrl!} className="w-full" />
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={clearRecording} size="sm">
                      <Trash2 className="mr-2 h-4 w-4" />
                      Retry
                    </Button>
                  </div>
                </div>
              )}

              <div className="h-px bg-border" />

              {/* Facial Cough Detection (Camera) */}
              <CameraCoughDetection onSummaryChange={handleCameraSummaryChange} />
              {cameraSummary && (
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className={cn(
                    "rounded-full px-2.5 py-1 font-medium",
                    cameraSummary.faceTracked
                      ? "bg-aura-accent-soft text-aura-accent-dark"
                      : "bg-aura-surface-alt text-aura-muted"
                  )}>
                    Face: {cameraSummary.faceTracked ? "tracked" : "not found"}
                  </span>
                  <span className="rounded-full bg-aura-surface-alt px-2.5 py-1 font-medium text-aura-muted">
                    Mouth distance:{" "}
                    {cameraSummary.mouthDistance != null
                      ? cameraSummary.mouthDistance.toFixed(3)
                      : "—"}
                  </span>
                  <span className={cn(
                    "rounded-full px-2.5 py-1 font-medium",
                    cameraSummary.coughDetected
                      ? "bg-aura-warning-soft text-aura-warning-strong"
                      : "bg-aura-surface-alt text-aura-muted"
                  )}>
                    Fused coughs: {cameraSummary.coughCount}
                  </span>
                </div>
              )}

              <div className="h-px bg-border" />

              {/* Upload Section */}
              <h3 className="text-lg font-medium">Upload Audio File</h3>
              <div
                className={cn(
                  "border-2 border-dashed rounded-lg p-8 text-center transition-colors",
                  dragActive ? "border-aura-accent bg-aura-accent/5" : uploadedFile ? "border-aura-accent bg-aura-accent/5" : "border-aura-border-soft"
                )}
                onDragOver={e => { e.preventDefault(); setDragActive(true) }}
                onDragLeave={e => { e.preventDefault(); setDragActive(false) }}
                onDrop={e => {
                  e.preventDefault()
                  setDragActive(false)
                  const file = e.dataTransfer.files[0]
                  const validExt = [".wav", ".mp3", ".flac", ".ogg", ".m4a"]
                  const isAudio = file && (file.type.startsWith("audio/") || validExt.some(ext => file.name.toLowerCase().endsWith(ext)))
                  if (isAudio) {
                    const event = { target: { files: e.dataTransfer.files } } as React.ChangeEvent<HTMLInputElement>
                    handleFileUpload(event)
                  } else {
                    toast.error("Unsupported file type. Please upload a WAV, MP3, FLAC, OGG, or M4A file.")
                  }
                }}
              >
                <input
                  type="file"
                  accept=".wav,.mp3,.flac,.ogg,.m4a,audio/*"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="audio-upload"
                />
                {uploadedFile ? (
                  <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
                    <FileAudio className="h-10 w-10 text-primary" />
                    <div className="text-left">
                      <p className="font-medium">{uploadedFile.name}</p>
                      <p className="text-sm text-aura-muted">{(uploadedFile.size / 1024).toFixed(1)} KB</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={clearRecording}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <Upload className="h-10 w-10 text-aura-muted" />
                    <p>Drag & drop a .wav file here, or click to browse</p>
                    <Button variant="outline" onClick={() => document.getElementById("audio-upload")?.click()}>
                      Browse Files
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Submit Button */}
            {audioBlob && (
              <Button
                onClick={submitForAnalysis}
                disabled={submitting}
                size="lg"
                className="w-full gap-2"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" role="status" aria-live="polite" />
                    Analyzing cough audio…
                  </>
                ) : (
                  <>
                    <Settings className="h-5 w-5" />
                    Run Analysis
                  </>
                )}
              </Button>
            )}
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
            <Card>
              <CardHeader>
                <CardTitle>Screening Result</CardTitle>
            <CardDescription>
              Patient: {result.patient_name} - {new Date(result.timestamp).toLocaleString()}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* TB Gatekeeper Result */}
            <div className="p-4 bg-aura-surface-alt rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">Tier 1: TB Gatekeeper</h3>
                {getTbBadge(result.tb_result.label)}
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-aura-muted">Confidence</p>
                  <p className="font-mono text-lg">{(result.tb_result.confidence * 100).toFixed(1)}%</p>
                </div>
                <div>
                  <p className="text-aura-muted">Cascade</p>
                  <p className="font-mono text-lg">{result.cascade}</p>
                </div>
              </div>
              <div className="mt-4">
                <p className="text-sm text-aura-muted mb-2">Probability Distribution</p>
                <div className="space-y-2">
                  {Object.entries(result.tb_result.probabilities || {}).map(([cls, prob]: [string, unknown]) => {
                    const p = prob as number
                    return (
                      <div key={cls} className="flex items-center justify-between text-sm">
                        <span className={cn("font-medium", cls === "TB" ? "text-destructive" : "text-aura-accent-dark")}>{cls}</span>
                        <div className="flex items-center gap-2 w-full max-w-xs">
                          <Progress value={(p * 100)} className="h-2 flex-1" />
                          <span className="font-mono w-16 text-right">{(p * 100).toFixed(1)}%</span>
                        </div>
                      </div>
                    )
                  })
                }
                </div>
              </div>
            </div>

            {/* Respiratory Result */}
            {result.respiratory_result && (
              <div className="p-4 bg-aura-surface-alt rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold">Tier 2: Respiratory Classifier</h3>
                  {getRespBadge(result.respiratory_result.label)}
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-aura-muted">Confidence</p>
                    <p className="font-mono text-lg">{(result.respiratory_result.confidence * 100).toFixed(1)}%</p>
                  </div>
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
            {result.tb_result.label === "TB" ? (
              <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
                <h4 className="font-semibold text-destructive flex items-center gap-2">
                  <AlertCircle className="h-5 w-5" />
                  High Priority: TB Detected
                </h4>
                <p className="mt-2 text-sm">Immediate referral for confirmatory TB testing recommended. Follow local TB protocols.</p>
              </div>
            ) : result.respiratory_result?.label === "Pneumonia" ? (
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
