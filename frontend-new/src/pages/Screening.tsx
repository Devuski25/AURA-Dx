"use client"

import { useState, useRef, useEffect, useMemo, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { motion, AnimatePresence, useReducedMotion } from "framer-motion"
import { scaleIn } from "@/lib/motion"
import { Loader2, Mic, MicOff, Trash2, CheckCircle, AlertCircle, ChevronRight, Settings, Plus, AlertTriangle, Search, MoreHorizontal, Pencil } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Input } from "@/components/ui/input"

import { useAuth } from "@/hooks/useAuth"
import { cn } from "@/lib/utils"
import { apiFetch, getApiUrl, isUnauthorized, notifySessionExpired } from "@/lib/api"
import { probe } from "@/lib/service-status"
import {
  useAudioInput,
  DeviceBanner,
  LevelMeter,
  NO_STETHOSCOPE_MESSAGE,
} from "@/components/AudioCapture"
import { SiteChip, SiteDetail } from "@/components/RecordingProtocol"
import {
  AUSCULTATION_SITES,
  MIN_TAKE_SEC,
  durationAdvice,
  takeQuality,
} from "@/lib/recording-protocol"
import { useCachedData, invalidate } from "@/hooks/useCachedData"
import { NewPatientModal } from "@/components/NewPatientModal"

/* Capture is stethoscope-only: no camera, no file upload. A clinician records
   between MIN_TAKES and MAX_TAKES separate takes; the batch is scored
   independently and fused by the inference service, which is what makes the
   result steadier than any single take. MIN_TAKES is a hard floor — below it
   there is not enough evidence for a confident read. */
const MIN_TAKES = 3
const MAX_TAKES = 5

/* Analysis progress.
 *
 * Three phases, because "Run Analysis" is not one thing. A clinician who clicks
 * it and sees an unchanging spinner for 40 seconds has no idea whether it is
 * working, stuck, or about to fail.
 *
 * Uploading gets a REAL percentage. XMLHttpRequest fires upload progress as
 * bytes leave the machine, so this is measured, not invented.
 *
 * Analysing gets a bar that approaches 90% and stops. The inference call is a
 * single POST that returns a verdict with no intermediate events, so there is
 * nothing to measure -- but pretending to a percentage anyway is worse than
 * being explicit: a bar that sits at 99% for 30 seconds is indistinguishable
 * from a hang, and it is exactly the failure people describe as "the website is
 * broken". Elapsed seconds are shown instead, which is real information about
 * whether the work is still advancing.
 *
 * The 90% ceiling is deliberate. 100% means done, and it is not done. */
type AnalysisPhase = "idle" | "checking" | "uploading" | "analysing" | "saving"

const PHASE_START_PCT: Record<AnalysisPhase, number> = {
  idle: 0,
  checking: 0,
  uploading: 5,
  analysing: 45,
  saving: 92,
}

const PHASE_LABEL: Record<AnalysisPhase, string> = {
  idle: "",
  checking: "Checking the service is ready…",
  uploading: "Uploading takes…",
  analysing: "Running the model…",
  saving: "Saving the result…",
}

/** Upload with real byte-level progress.
 *
 * fetch() cannot report upload progress -- it resolves only once the response
 * arrives, and it exposes no intermediate events -- so this is the one place in
 * the app that still uses XMLHttpRequest. A 5-take batch is a few MB, and on a
 * clinic uplink that is long enough to be worth showing.
 *
 * Abort is wired to the same signal the rest of the flow uses, so the existing
 * cancel path keeps working.
 */
function uploadWithProgress(args: {
  url: string
  formData: FormData
  token: string
  signal: AbortSignal
  onProgress: (percent: number) => void
}): Promise<{ ok: boolean; status: number; data: any }> {
  const { url, formData, token, signal, onProgress } = args
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", url)
    xhr.setRequestHeader("Authorization", `Bearer ${token}`)

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) {
        onProgress(Math.round((e.loaded / e.total) * 100))
      }
    }

    // A cancelled upload rejects with a real AbortError, so the catch block in
    // submitForAnalysis keeps distinguishing "cancelled" from "failed" on the
    // same name it already checks for the screening call.
    const onAbort = () => {
      xhr.abort()
      const err = new Error("aborted")
      err.name = "AbortError"
      reject(err)
    }
    signal.addEventListener("abort", onAbort, { once: true })

    xhr.onload = () => {
      signal.removeEventListener("abort", onAbort)
      let data: any = {}
      try {
        data = JSON.parse(xhr.responseText || "{}")
      } catch {
        data = {}
      }
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, data })
    }
    xhr.onerror = () => {
      signal.removeEventListener("abort", onAbort)
      reject(new Error("Network error during upload"))
    }
    xhr.onabort = () => {
      signal.removeEventListener("abort", onAbort)
      const err = new Error("aborted")
      err.name = "AbortError"
      reject(err)
    }

    xhr.send(formData)
  })
}

type Take = {
  id: string
  url: string
  blob: Blob
  durationSec: number
  /** Auscultation site, when the clinician picked one. Never required. */
  siteCode?: string
}

const dobDateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" })

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

/* Columns: avatar | name | details (sm+) | status (sm+) | chevron | row menu.
   Two extra trailing tracks for the chevron and the 3-dot menu trigger.

   Rows are a <div>, not a <button>, because the menu trigger is itself a button
   and nesting one interactive element inside another is invalid HTML -- it also
   makes the row unclickable in some browsers. The whole row stays clickable via
   a stretched overlay button sitting underneath the menu at a lower z-index.

   PHONE: two tracks -- the name and the one action control. The chevron is
   desktop-only. On a phone it was a second control saying the same thing as
   the row itself ("tap here to select"), competing with the 3-dot menu for the
   right-hand margin, and the two together pushed the name into a corner. One
   control on the right leaves the name the width it needs and the margin
   clean.

   There is no avatar track at any width. The circle of initials sat between
   the row's left edge and the name, so the name was never aligned with the
   card's own left padding -- it was indented past a 32px badge and its gap.
   With the badge gone the name is the first cell and lines up with the
   "Select Patient" title above it.

   The padding is the card header's padding, px-4 and sm:px-5, for the same
   reason: the name has to sit on the same vertical line as everything else in
   the card.

   The header row is why the two must agree on the track count. It has the
   same number of children as the row only from `sm` up, where both are five.
   On a phone the header's extra headings are hidden, so what is left is
   "Patient" and "Action" -- two children for two tracks. The row has two. When
   the header still had all six headings in a four-track grid they wrapped onto
   a second row, and "Action" broke across two lines as "Acti on" over a
   clipped row. */
const PATIENT_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-2.5 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1.5fr)_122px_auto_auto] sm:px-5"

/* How many patient rows the picker shows before it starts scrolling.
   Five is roughly a screenful on a phone with the search box and the New
   Patient button still visible, and it keeps the list from growing until the
   pinned footer is pushed out of reach. Height rather than a slice-and-paginate
   so a filtered list still shows matches rather than hiding them behind a
   pager. */
const PATIENT_LIST_MAX_H = "max-h-[19rem] sm:max-h-[20rem]"

/* One row of the patient picker. Carries the raw DOB alongside the formatted
   one so the edit form can be seeded without re-parsing the display string. */
type PatientOption = {
  id: string
  name: string
  patientId: string
  dob: string
  dobRaw: string
  age: number | null
  gender: string
}

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
  /* Peak level reached during the current take, read once when it stops. The
     live meter is a momentary value; this is what the warning needs. */
  const peakLevelRef = useRef<number>(0)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [selectedSite, setSelectedSite] = useState<string>(AUSCULTATION_SITES[0].code)
  const selectedSiteRef = useRef<string>(AUSCULTATION_SITES[0].code)

  // The site is read inside MediaRecorder's onstop closure, which is created
  // when recording starts. A ref keeps it current without restarting the
  // recorder every time the clinician changes their mind.
  useEffect(() => {
    selectedSiteRef.current = selectedSite
  }, [selectedSite])

  const audioInput = useAudioInput()

  // Keep the peak tracked from the live meter.
  useEffect(() => {
    if (recording && audioInput.level > peakLevelRef.current) {
      peakLevelRef.current = audioInput.level
    }
  }, [recording, audioInput.level])

  /* Ticks only while recording. A running interval on a capture screen would
     keep re-rendering the whole page once a second for nothing. */
  useEffect(() => {
    if (!recording) {
      setElapsedSec(0)
      return
    }
    const id = window.setInterval(() => {
      setElapsedSec((Date.now() - recordingStartTimeRef.current) / 1000)
    }, 200)
    return () => window.clearInterval(id)
  }, [recording])
  const abortControllerRef = useRef<AbortController | null>(null)

  // Result state
  const [result, setResult] = useState<any>(null)
  const [submitting, setSubmitting] = useState(false)
  const [phase, setPhase] = useState<AnalysisPhase>("idle")
  const [pct, setPct] = useState(0)
  const [elapsed, setElapsed] = useState(0)

  /* Elapsed seconds during the analysis phase, plus a bar that creeps toward
   * the ceiling. The creep is presentation only -- it is not a measurement and
   * never reaches 100, because 100% is reserved for an actual result. */
  useEffect(() => {
    if (!submitting || phase !== "analysing") return
    const startedAt = Date.now()
    const id = window.setInterval(() => {
      const secs = (Date.now() - startedAt) / 1000
      setElapsed(secs)
      const creep = PHASE_START_PCT.analysing +
        (1 - Math.exp(-secs / 12)) * (PHASE_START_PCT.saving - PHASE_START_PCT.analysing)
      setPct(Math.round(Math.min(creep, PHASE_START_PCT.saving - 1)))
    }, 250)
    return () => window.clearInterval(id)
  }, [submitting, phase])

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
    const res = await apiFetch("/api/patients")
    // An expired token must not read as "failed to fetch". apiFetch already
    // refreshes and retries once before this point, so reaching here means the
    // session really is gone.
    if (isUnauthorized(res)) {
      notifySessionExpired()
      throw new Error("Session expired")
    }
    if (!res.ok) throw new Error("Failed to fetch patients")
    return res.json()
  }, [accessToken])

  const screeningsFetcher = useCallback(async (): Promise<Array<Record<string, unknown>>> => {
    const res = await apiFetch("/api/screenings")
    if (isUnauthorized(res)) {
      notifySessionExpired()
      throw new Error("Session expired")
    }
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

  const patientOptions = useMemo<PatientOption[]>(
    () =>
      patients.map(p => ({
        id: p.id,
        name: p.full_name,
        patientId: p.id.toUpperCase(),
        dob: p.date_of_birth ? dobDateFormat.format(new Date(p.date_of_birth)) : "—",
        dobRaw: p.date_of_birth ?? "",
        age: p.date_of_birth ? ageOf(p.date_of_birth) : null,
        gender: p.gender ?? "",
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

  /* Edit and delete from the patient picker's row menu.

     Edit reuses the new-patient form in PATCH mode rather than duplicating the
     schema, so a field added to the form appears in both paths at once. Delete
     is confirmed first because it cascades to the patient's screenings -- that
     is not recoverable from the UI, so the confirmation names it. */
  const [editingPatient, setEditingPatient] = useState<PatientOption | null>(null)
  const [deletingPatient, setDeletingPatient] = useState<PatientOption | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const handleEditPatient = (patient: PatientOption) => {
    setSavedFormData(null)
    setEditingPatient(patient)
    setNewPatientModalOpen(true)
  }

  const handleDeletePatient = async () => {
    if (!deletingPatient) return
    setDeleteBusy(true)
    try {
      const res = await apiFetch(`/api/patients/${deletingPatient.id}`, { method: "DELETE" })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || "Failed to delete patient")
      }
      invalidate("patients")
      invalidate("patient-records")
      invalidate("screenings")
      void refreshPatients()
      // Deleting the patient currently selected would otherwise leave the
      // wizard pointing at a record that no longer exists.
      if (selectedPatient?.id === deletingPatient.id) setSelectedPatient(null)
      toast.success(`${deletingPatient.name} deleted`)
      setDeletingPatient(null)
    } catch (error) {
      console.error("Error deleting patient:", error)
      toast.error(error instanceof Error ? error.message : "Failed to delete patient")
    } finally {
      setDeleteBusy(false)
    }
  }

  const handleNewPatientCreated = (patient: { id: string; full_name: string }, formData?: any) => {
    /* An edit keeps the wizard where it was; only a fresh patient advances to
       the recording step. Advancing after an edit would yank the clinician out
       of the list they were working in. */
    if (!editingPatient) setStep("record")
    if (formData) setSavedFormData(formData)
    setSelectedPatient({ id: patient.id, name: patient.full_name })
    setEditingPatient(null)
    setNewPatientModalOpen(false)
    if (editingPatient) void refreshPatients()
  }

  const stepIndex = ["patient", "record", "result"].indexOf(step)

  // --- Audio Recording ---
  const startRecording = async () => {
    try {
      /* Opens through the shared input hook so the level meter is wired to the
       * exact stream being captured. Previously the meter could not exist at
       * all, which is why the bars animated on a timer instead.
       *
       * openOnStethoscope re-runs enumerateDevices and then opens on a verified
       * external input with `deviceId: { exact: ... }`. Passing no deviceId at
       * all is what made MediaRecorder fall back to the phone's own microphone,
       * so the exact-match constraint is the whole point and there is no path
       * here that can omit it. */
      const opened = await audioInput.openOnStethoscope()
      if (!opened.ok) {
        toast.error("Digital stethoscope not detected", {
          description: NO_STETHOSCOPE_MESSAGE,
          duration: 9000,
        })
        return
      }
      const stream = opened.stream
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
        // The hook owns the stream; it is released here rather than by tracking
        // its tracks in two places, which is how a track used to outlive the
        // take and leave the meter showing a live level while recording stopped.
        await audioInput.close()

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

        // Warn on a take that will not analyse well, but still keep it. A
        // take is the clinician's decision to discard -- silently dropping
        // their recording, or refusing to save it, is worse than telling them
        // it was short and letting them decide.
        const quality = takeQuality(durationSec)
        if (quality === "too-short") {
          toast.warning(
            `That take was ${durationSec.toFixed(1)}s — under ${MIN_TAKE_SEC}s, `
            + `so it may not analyse reliably. Record a replacement if you can.`,
            { duration: 7000 }
          )
        }
        if (peakLevelRef.current > 0.97) {
          toast.warning(
            "That take was clipped — the signal was too loud. Move the "
            + "stethoscope further from the skin and record another.",
            { duration: 7000 }
          )
        }

        setTakes(prev => [
          ...prev,
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            url, blob, durationSec,
            siteCode: selectedSiteRef.current,
          },
        ])
      }

      recordingStartTimeRef.current = Date.now()
      peakLevelRef.current = 0
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
    setPhase("checking")
    setPct(PHASE_START_PCT.checking)
    setElapsed(0)
    abortControllerRef.current = new AbortController()

    try {
      /* --- Pre-flight --------------------------------------------------
       *
       * Ask the backend whether it and the inference service are both up
       * BEFORE uploading anything.
       *
       * This exists because of a real failure mode on this machine: the
       * inference process can lose its listening socket, keep running with
       * both models resident, and answer nothing. A clinician who clicks Run
       * Analysis in that state uploads every take, waits through a 150-second
       * timeout, and then loses the error in a toast -- having recorded three
       * or five takes for nothing.
       *
       * `/api/status` is the right question because it probes both sides and
       * is served from a short cache, so this costs a few milliseconds rather
       * than a round trip per component.
       */
      const preflight = await probe()
      if (preflight.availability === "offline") {
        throw new Error(
          "Cannot reach the AURA-Dx service. Your takes are saved on this device — try again once the Mini PC is back."
        )
      }
      if (preflight.availability === "degraded") {
        throw new Error(
          "The analysis service is not responding. Your takes are saved on this device — try again in a moment."
        )
      }

      // Step 1: upload every take as its own file. They are deliberately NOT
      // concatenated: the inference service scores each take separately and
      // then fuses the per-take verdicts, so merging them here would destroy
      // the per-take evidence the fusion step depends on.
      const uploadFormData = new FormData()
      takes.forEach((take, i) => {
        uploadFormData.append("audios", take.blob, `take-${i + 1}.wav`)
      })

      setPhase("uploading")
      const upload = await uploadWithProgress({
        url: getApiUrl("/api/audio/upload"),
        formData: uploadFormData,
        token: accessToken,
        signal: abortControllerRef.current.signal,
        // Real byte progress, mapped onto the uploading band's 5-45%.
        onProgress: (uploaded) =>
          setPct(
            Math.round(
              PHASE_START_PCT.uploading +
                (uploaded / 100) * (PHASE_START_PCT.analysing - PHASE_START_PCT.uploading)
            )
          ),
      })

      if (!upload.ok) {
        // 401 means the access token expired -- routine after an hour with the
        // tab open. Report it as such rather than letting it surface as a save
        // failure the clinician cannot act on.
        if (isUnauthorized({ status: upload.status } as Response)) {
          notifySessionExpired()
          return
        }
        throw new Error(upload.data?.detail || "Audio upload failed")
      }
      const { file_paths } = upload.data

      // Step 2: Create screening via backend (handles inference + DB save)
      setPhase("analysing")
      setPct(PHASE_START_PCT.analysing)

      const screeningResponse = await apiFetch("/api/screenings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: selectedPatient.id,
          audio_file_paths: file_paths,
          audio_duration_sec: Math.round(totalRecordedSec * 100) / 100 || undefined,
        }),
        signal: abortControllerRef.current.signal,
      })

      if (!screeningResponse.ok) {
        if (isUnauthorized(screeningResponse)) {
          notifySessionExpired()
          return
        }
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
      setPct(100)
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
      setPhase("idle")
      setPct(0)
      setElapsed(0)
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
                                <div className={cn(PATIENT_LIST_MAX_H, "aura-table-scroll overflow-y-auto overscroll-contain")}>
                                  {/* Column labels (decorative; rows are self-describing buttons).

                                      On a phone only "Patient" and "Action"
                                      are shown, matching the two columns the
                                      row has at that width: the name on the
                                      left, and the heading for the 3-dot
                                      menu on the right. The other headings
                                      describe columns that are not on screen
                                      at that width, and putting them in the
                                      header made the row wrap -- the labels
                                      did not fit the tracks the rows use, so
                                      "Action" broke across two lines as
                                      "Acti on" and the list was clipped.

                                      From `sm` up the row has the details,
                                      status and action columns, and the
                                      headings come back with them. The last
                                      cell is empty because the menu is a
                                      control rather than a column of data. */}
                                  <div
                                    aria-hidden="true"
                                    className={cn(PATIENT_GRID, "sticky top-0 z-10 border-b border-aura-border-soft bg-aura-surface-alt pb-2 pt-3 text-xs font-medium text-aura-muted")}
                                  >
                                    <span>Patient</span>
                                    <span className="hidden sm:block">Details</span>
                                    <span className="hidden sm:block">Status</span>
                                    <span className="text-right">Action</span>
                                    <span className="hidden sm:block" />
                                  </div>
                                  {visiblePatients.map(patient => {
                                    const isSelected = selectedPatient?.id === patient.id
                                    const badge = statusBadgeFor(patient.id)
                                    return (
                                      <div
                                        key={patient.id}
                                        className={cn(
                                          PATIENT_GRID,
                                          "group relative border-b border-aura-border-soft transition-colors last:border-b-0",
                                          isSelected
                                            ? "bg-green-50 ring-1 ring-inset ring-green-600"
                                            : "bg-aura-elevated hover:bg-aura-surface-alt"
                                        )}
                                      >
                                        {/* No avatar. The circle of initials
                                            sat between the row's left edge
                                            and the name, so the name was
                                            never aligned with the card's
                                            own left padding -- it was
                                            indented past a 32px badge and
                                            its gap. The name is the first
                                            cell now, and lines up with
                                            the "Select Patient" title
                                            above it. */}
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
                                        {/* The chevron is desktop only. On a
                                            phone it duplicated the row's own
                                            tap-to-select affordance and took
                                            the width the name needed. The
                                            3-dot menu is the one control on
                                            the right at every width. */}
                                        <span className="hidden justify-end sm:flex">
                                          <ChevronRight
                                            aria-hidden="true"
                                            className="h-4 w-4 shrink-0 text-aura-muted transition-transform group-hover:translate-x-0.5"
                                          />
                                        </span>
                                        {/* z-10 so the menu sits above the stretched click
                                            target below; relative so it keeps a stacking
                                            context of its own. */}
                                        <DropdownMenu>
                                          <DropdownMenuTrigger asChild>
                                            <button
                                              type="button"
                                              aria-label={`Actions for ${patient.name}`}
                                              className="relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-aura-muted transition-colors hover:bg-aura-surface-alt hover:text-aura-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                            >
                                              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                                            </button>
                                          </DropdownMenuTrigger>
                                          <DropdownMenuContent align="end" className="w-44">
                                            <DropdownMenuLabel className="truncate text-xs text-aura-muted">
                                              {patient.name}
                                            </DropdownMenuLabel>
                                            <DropdownMenuItem
                                              onSelect={() => handleEditPatient(patient)}
                                            >
                                              <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
                                              Edit details
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                              onSelect={() => setDeletingPatient(patient)}
                                              className="text-destructive focus:text-destructive"
                                            >
                                              <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                                              Delete
                                            </DropdownMenuItem>
                                          </DropdownMenuContent>
                                        </DropdownMenu>
                                        {/* Stretched click target: the row remains one
                                            button for selection and for screen readers,
                                            without nesting the menu inside it. */}
                                        <button
                                          type="button"
                                          aria-label={`Start screening for ${patient.name}`}
                                          aria-pressed={isSelected}
                                          onClick={() => handlePatientSelect({ id: patient.id, name: patient.name })}
                                          className="absolute inset-0 z-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:scale-[0.995]"
                                        />
                                      </div>
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
          if (!open) {
            if (savedFormData) setSavedFormData(null)
            // Closing must also clear the edit target, or reopening with the
            // New Patient button would PATCH the last patient edited.
            setEditingPatient(null)
          }
        }}
        onPatientCreated={handleNewPatientCreated}
        initialData={
          editingPatient
            ? {
                full_name: editingPatient.name,
                date_of_birth: editingPatient.dobRaw,
                gender: (editingPatient.gender || "male") as "male" | "female" | "other",
                smoking_history: false,
                past_respiratory_diseases: [] as string[],
                symptoms: [] as string[],
              }
            : savedFormData
        }
        editingPatientId={editingPatient?.id ?? null}
      />

      {/* Delete confirmation.

          Says plainly that the screenings go too. A generic "are you sure?" on
          a destructive action that cascades to clinical records is how a
          clinician destroys a screening history by muscle memory.

          Uses Dialog rather than an alert-dialog primitive, which this project
          does not have; Admin's delete dialog sets the precedent. No `sm:top-*`
          override -- DialogContent centres itself, and overriding top while the
          -translate-y-1/2 still applies floats the panel instead of centring it. */}
      <Dialog
        open={Boolean(deletingPatient)}
        onOpenChange={(open) => {
          if (!open) setDeletingPatient(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" aria-hidden="true" />
              Delete patient
            </DialogTitle>
            <DialogDescription className="pt-2">
              Delete{" "}
              <span className="font-semibold text-foreground">{deletingPatient?.name}</span>?
              <br />
              This removes the patient record and{" "}
              <span className="font-semibold text-destructive">
                every screening result recorded against them
              </span>
              . It cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setDeletingPatient(null)}
              disabled={deleteBusy}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDeletePatient()}
              disabled={deleteBusy}
            >
              {deleteBusy ? "Deleting…" : "Delete patient"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            {/* What is actually plugged in. Without this a clinician cannot
                tell the stethoscope from the built-in microphone, and the two
                are indistinguishable until the takes come back useless. This
                also carries the audio-input picker, so it is the one place
                the device is chosen. */}
            <DeviceBanner
              devices={audioInput.devices}
              device={audioInput.device}
              permission={audioInput.permission}
              selectedId={audioInput.selectedId}
              mismatch={audioInput.deviceMismatch}
              onSelect={audioInput.setSelectedId}
              onRefresh={() => void audioInput.refreshDevices()}
            />

            {/* Site for this take. Suggested, never enforced. */}
            {!recording && !atMaxTakes && (
              <div>
                {/* Follows the dropdown, so the instructions always describe
                    the place the take is about to be recorded from. */}
                <SiteDetail
                  code={selectedSite}
                  takeNumber={Math.min(takes.length + 1, MAX_TAKES)}
                  lastSiteCode={takes[takes.length - 1]?.siteCode}
                />
                {/* Stacked on a phone, side by side from sm. Both selects are
                    short controls; on a 375px screen they need the full width
                    to stay tappable, and on a tablet they are wasting a row
                    each. */}
                <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="aura-site"
                        className="block text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-aura-muted"
                      >
                        Site for this take
                      </label>
                      <select
                        id="aura-site"
                        value={selectedSite}
                        onChange={(e) => setSelectedSite(e.target.value)}
                        className="mt-1.5 h-11 w-full rounded-lg border border-aura-border bg-white px-2.5 text-sm text-aura-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-forest"
                      >
                        {AUSCULTATION_SITES.map((s) => (
                          <option key={s.code} value={s.code}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label
                        htmlFor="aura-take-site-history"
                        className="block text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-aura-muted"
                      >
                        Covers this take
                      </label>
                      {/* Informational, so it stays read-only. Its real job is
                          making the planned sequence visible at a glance rather
                          than buried in the collapsed protocol card. */}
                      <p
                        id="aura-take-site-history"
                        className="mt-1.5 flex h-11 items-center rounded-lg border border-aura-border-soft bg-aura-surface-alt px-2.5 text-sm text-aura-muted"
                      >
                        {takes.length === 0
                          ? "First take"
                          : `Take ${Math.min(takes.length + 1, MAX_TAKES)} of ${MAX_TAKES}`}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Level meter. Real signal, so silence looks like silence. */}
              <LevelMeter
                level={audioInput.level}
                clipped={audioInput.clipped}
                active={recording}
              />

              {!recording && (
                <Button
                  onClick={startRecording}
                  size="lg"
                  disabled={atMaxTakes || !audioInput.ready}
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

              {/* Why the record button is disabled. Without this the button is
                  simply inert and looks broken rather than blocked.
                  `ready` is false either because permission was refused or
                  because no input has been chosen -- and the second case is the
                  one that matters, since an unchosen input means the browser
                  would quietly use the system default, which on a laptop is the
                  built-in microphone. */}
              {!recording && !atMaxTakes && !audioInput.ready && (
                <p className="text-center text-sm font-medium text-amber-800">
                  {audioInput.permission === "denied"
                    ? "Microphone access is blocked. Allow it in your browser settings to record."
                    : audioInput.permission === "unsupported"
                      ? "This browser does not provide audio input, so recording is unavailable."
                      : audioInput.devices.length === 0
                        ? "No audio input found. Connect the stethoscope, then press refresh."
                        : "Choose your stethoscope from Audio input above before recording."}
                </p>
              )}
              {recording && (
                <>
                  {/* Live clock and guidance. The numbers come from
                      recording-protocol.ts, not from a second copy here. */}
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-mono tabular-nums text-aura-ink">
                      {elapsedSec.toFixed(1)}s
                    </span>
                    <span
                      className={cn(
                        "text-right text-xs leading-snug",
                        elapsedSec >= MIN_TAKE_SEC
                          ? "text-aura-pine"
                          : "text-amber-700"
                      )}
                    >
                      {durationAdvice(elapsedSec)}
                    </span>
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
                    {takes.map((take, index) => {
                      const quality = takeQuality(take.durationSec)
                      return (
                      <li
                        key={take.id}
                        className={cn(
                          "flex flex-col gap-3 rounded-lg border bg-aura-surface-alt p-4 sm:flex-row sm:items-center",
                          quality === "too-short"
                            ? "border-amber-300 bg-amber-50"
                            : "border-aura-border-soft"
                        )}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <span
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-aura-forest/10 text-sm font-bold tabular-nums text-aura-forest"
                            aria-hidden="true"
                          >
                            {index + 1}
                          </span>
                          <div className="min-w-0">
                            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-aura-ink">
                              Take {index + 1}
                              <span className="font-normal tabular-nums text-aura-muted">
                                {take.durationSec.toFixed(1)}s
                              </span>
                              <SiteChip code={take.siteCode} />
                            </p>
                            {quality === "too-short" && (
                              <p className="mt-0.5 text-xs leading-snug text-amber-800">
                                Too short to analyse reliably — record a replacement
                                if you can.
                              </p>
                            )}
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
                      )
                    })}
                  </ul>
                </div>
              )}

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

              {/* Progress. Replaces the bare spinner inside the button with
                  something that says which stage it is on and how far along.

                  The percentage is real for the upload phase and deliberately
                  capped below 100 for the analysis phase, where the model gives
                  no intermediate events. Elapsed seconds are shown alongside so
                  a slow run still tells the clinician it is moving. */}
              {submitting && (
                <div className="space-y-2 pt-1" role="status" aria-live="polite">
                  <Progress value={pct} className="h-2" aria-label="Analysis progress" />
                  <div className="flex items-baseline justify-between gap-3 text-xs text-aura-muted">
                    <span>{PHASE_LABEL[phase]}</span>
                    <span className="tabular-nums">
                      {phase === "analysing" && elapsed >= 1
                        ? `${Math.round(pct)}% · ${elapsed.toFixed(0)}s elapsed`
                        : `${Math.round(pct)}%`}
                    </span>
                  </div>
                </div>
              )}
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
                    {/* Highest first, so the class the result names is the one
                        at the top of the list. The key order of a plain object
                        is whatever the database happened to return. */}
                    {Object.entries((result.respiratory_result.probabilities as Record<string, number>) || {})
                      .sort((a, b) => b[1] - a[1])
                      .map(([cls, prob]) => (
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
