"use client"

import { useState, useRef, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { Loader2, Mic, MicOff, FileAudio, Play, Pause, Trash2, Upload, X, CheckCircle, AlertCircle, ChevronRight, Settings, Plus, Calendar, AlertTriangle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAuth } from "@/hooks/useAuth"
import { cn } from "@/lib/utils"
import { NewPatientModal } from "@/components/NewPatientModal"

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8001"

export function Screening() {
  const { user, accessToken } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState<"patient" | "record" | "result">("patient")
  const [selectedPatient, setSelectedPatient] = useState<{ id: string; name: string } | null>(null)
  const [patients, setPatients] = useState<Array<{ id: string; full_name: string; date_of_birth: string; gender: string }>>([])
  const [loadingPatients, setLoadingPatients] = useState(true)

  // Recording state
  const [recording, setRecording] = useState(false)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordingStartTimeRef = useRef<number>(0)
  const audioDurationRef = useRef<number>(0)

  // Upload state
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)

  // Result state
  const [result, setResult] = useState<any>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (user) {
      fetchPatients()
    }
  }, [user])

  const fetchPatients = async () => {
    if (!user || !accessToken) return
    setLoadingPatients(true)
    try {
      const res = await fetch(`${API_BASE}/api/patients`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      })
      if (!res.ok) throw new Error("Failed to fetch patients")
      const data = await res.json()
      setPatients(data || [])
    } catch (error) {
      console.error("Error fetching patients:", error)
    } finally {
      setLoadingPatients(false)
    }
  }

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
    fetchPatients()
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
          const arrayBuffer = await rawBlob.arrayBuffer()
          const audioCtx = new AudioContext()
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
          await audioCtx.close()

          const wavBlob = await encodeWav(audioBuffer)
          setAudioBlob(wavBlob)
          setAudioUrl(URL.createObjectURL(wavBlob))
        } catch (convError) {
          console.error("WAV conversion error, falling back to raw blob:", convError)
          setAudioBlob(rawBlob)
          setAudioUrl(URL.createObjectURL(rawBlob))
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
    const blockAlign = numChannels * bytesPerSample
    const data = audioBuffer.getChannelData(0)
    const dataLength = data.length * bytesPerSample
    const bufferLength = 44 + dataLength
    const arrayBuffer = new ArrayBuffer(bufferLength)
    const view = new DataView(arrayBuffer)

    const writeStr = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
    }

    writeStr(0, 'RIFF')
    view.setUint32(4, bufferLength - 8, true)
    writeStr(8, 'WAVE')
    writeStr(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, numChannels, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * blockAlign, true)
    view.setUint16(32, blockAlign, true)
    view.setUint16(34, bitsPerSample, true)
    writeStr(36, 'data')
    view.setUint32(40, dataLength, true)

    let offset = 44
    for (let i = 0; i < data.length; i++) {
      const s = Math.max(-1, Math.min(1, data[i]))
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
      offset += 2
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
    setAudioBlob(null)
    setAudioUrl(null)
    setUploadedFile(null)
    audioChunksRef.current = []
  }

  // --- File Upload ---
const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && file.type.startsWith("audio/")) {
      setUploadedFile(file)
      setAudioBlob(file)
      setAudioUrl(URL.createObjectURL(file))
      const audio = new Audio()
      audio.src = URL.createObjectURL(file)
      audio.onloadedmetadata = () => {
        audioDurationRef.current = audio.duration
        URL.revokeObjectURL(audio.src)
      }
    }
  }

  // --- Submit for Analysis ---
  const submitForAnalysis = async () => {
    if (!audioBlob || !selectedPatient || !accessToken) return

    setSubmitting(true)
    try {
      // Step 1: Upload audio file to backend
      const uploadFormData = new FormData()
      uploadFormData.append("audio", audioBlob, "recording.wav")

      const uploadResponse = await fetch(`${API_BASE}/api/audio/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: uploadFormData,
      })

      if (!uploadResponse.ok) {
        const error = await uploadResponse.json()
        throw new Error(error.detail || "Audio upload failed")
      }

      const { file_path } = await uploadResponse.json()

      // Step 2: Create screening via backend (handles inference + DB save)
      const screeningResponse = await fetch(`${API_BASE}/api/screenings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          patient_id: selectedPatient.id,
          audio_file_path: file_path,
          audio_duration_sec: Math.round(audioDurationRef.current * 100) / 100 || undefined,
        }),
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
      })

      setStep("result")
    } catch (error: any) {
      console.error("Analysis error:", error)
      toast.error("Analysis failed: " + (error instanceof Error ? error.message : "Unknown error"))
    } finally {
      setSubmitting(false)
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
    setSelectedPatient(null)
    setAudioBlob(null)
    setAudioUrl(null)
    setUploadedFile(null)
    setResult(null)
    setStep("patient")
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Progress Steps */}
      <div className="flex items-center justify-center gap-4">
        {["patient", "record", "result"].map((s, i) => (
          <div key={s} className="flex flex-col items-center">
            <div
              className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium transition-colors",
                step === s ? "bg-primary text-primary-foreground" :
                ["patient", "record"].indexOf(step) >= i ? "bg-green-500 text-white" :
                "bg-muted text-muted-foreground"
              )}
            >
              {step === s ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : ["patient", "record"].indexOf(step) >= i ? (
                <CheckCircle className="h-5 w-5" />
              ) : (
                i + 1
              )}
            </div>
            <span className={cn("mt-1 text-sm font-medium", step === s ? "text-primary" : "text-muted-foreground")}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </span>
          </div>
        ))}
      </div>

      {/* Step 1: Patient Selection */}
      {step === "patient" && (
        <Card>
          <CardHeader>
            <CardTitle>Select Patient</CardTitle>
            <CardDescription>Choose an existing patient or create a new screening</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingPatients ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : patients.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground mb-4">No patients found. Create a screening for a new patient.</p>
                <Button onClick={() => setNewPatientModalOpen(true)} size="lg">
                  <Plus className="mr-2 h-4 w-4" />
                  New Patient Screening
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {patients.map(patient => (
                  <Button
                    key={patient.id}
                    variant="outline"
                    className="w-full justify-start gap-4"
                    onClick={() => handlePatientSelect({ id: patient.id, name: patient.full_name })}
                  >
                    <div className="flex-1 text-left">
                      <div className="font-medium">{patient.full_name}</div>
                      <div className="text-sm text-muted-foreground">
                        DOB: {new Date(patient.date_of_birth).toLocaleDateString()} - {patient.gender}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                ))}
                <Button variant="outline" onClick={() => setNewPatientModalOpen(true)} className="w-full">
                  <Plus className="mr-2 h-4 w-4" />
                  New Patient
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
      {step === "record" && (
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
                <Button
                  onClick={stopRecording}
                  size="lg"
                  variant="destructive"
                  className="w-full gap-3"
                >
                  <MicOff className="h-5 w-5" />
                  Stop Recording
                </Button>
              )}
              {audioBlob && (
                <div className="flex items-center gap-4 p-4 bg-muted rounded-lg">
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

              {/* Upload Section */}
              <h3 className="text-lg font-medium">Upload Audio File</h3>
              <div
                className={cn(
                  "border-2 border-dashed rounded-lg p-8 text-center transition-colors",
                  uploadedFile ? "border-primary bg-primary/5" : "border-muted-foreground/25"
                )}
                onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add("border-primary", "bg-primary/5") }}
                onDragLeave={e => { e.preventDefault(); e.currentTarget.classList.remove("border-primary", "bg-primary/5") }}
                onDrop={e => {
                  e.preventDefault()
                  const file = e.dataTransfer.files[0]
                  if (file && file.type === "audio/wav") {
                    setUploadedFile(file)
                    setAudioBlob(file)
                    setAudioUrl(URL.createObjectURL(file))
                  }
                }}
              >
                <input
                  type="file"
                  accept=".wav"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="audio-upload"
                  ref={fileInputRef}
                />
                {uploadedFile ? (
                  <div className="flex items-center justify-center gap-4">
                    <FileAudio className="h-10 w-10 text-primary" />
                    <div className="text-left">
                      <p className="font-medium">{uploadedFile.name}</p>
                      <p className="text-sm text-muted-foreground">{(uploadedFile.size / 1024).toFixed(1)} KB</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => { setUploadedFile(null); setAudioBlob(null); setAudioUrl(null); }}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <Upload className="h-10 w-10 text-muted-foreground" />
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
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Analyzing cough audio...
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
      )}

      {/* Step 3: Results */}
      {step === "result" && result && (
        <Card>
          <CardHeader>
            <CardTitle>Screening Result</CardTitle>
            <CardDescription>
              Patient: {result.patient_name} - {new Date(result.timestamp).toLocaleString()}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* TB Gatekeeper Result */}
            <div className="p-4 bg-muted/50 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">Tier 1: TB Gatekeeper</h3>
                {getTbBadge(result.tb_result.label)}
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Confidence</p>
                  <p className="font-mono text-lg">{(result.tb_result.confidence * 100).toFixed(1)}%</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Cascade</p>
                  <p className="font-mono text-lg">{result.cascade}</p>
                </div>
              </div>
              <div className="mt-4">
                <p className="text-sm text-muted-foreground mb-2">Probability Distribution</p>
                <div className="space-y-2">
                  {Object.entries(result.tb_result.probabilities || {}).map(([cls, prob]: [string, unknown]) => {
                    const p = prob as number
                    return (
                      <div key={cls} className="flex items-center justify-between text-sm">
                        <span className={cn("font-medium", cls === "TB" ? "text-destructive" : "text-green-600 dark:text-green-400")}>{cls}</span>
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
              <div className="p-4 bg-muted/50 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold">Tier 2: Respiratory Classifier</h3>
                  {getRespBadge(result.respiratory_result.label)}
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Confidence</p>
                    <p className="font-mono text-lg">{(result.respiratory_result.confidence * 100).toFixed(1)}%</p>
                  </div>
                </div>
                <div className="mt-4">
                  <p className="text-sm text-muted-foreground mb-2">Probability Distribution</p>
                  <div className="space-y-2">
                    {Object.entries((result.respiratory_result.probabilities as Record<string, number>) || {}).map(([cls, prob]) => (
                      <div key={cls} className="flex items-center justify-between text-sm">
                        <span className={cn("font-medium", cls === "Pneumonia" ? "text-destructive" : cls === "COPD" ? "text-yellow-600 dark:text-yellow-400" : "text-green-600 dark:text-green-400")}>{cls}</span>
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
              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg dark:bg-yellow-900/20 dark:border-yellow-800">
                <h4 className="font-semibold text-yellow-700 dark:text-yellow-300 flex items-center gap-2">
                  <AlertCircle className="h-5 w-5" />
                  Moderate Priority: COPD Suspected
                </h4>
                <p className="mt-2 text-sm">Clinical evaluation recommended. Consider spirometry and pulmonology referral.</p>
              </div>
            ) : (
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg dark:bg-green-900/20 dark:border-green-800">
                <h4 className="font-semibold text-green-700 dark:text-green-300 flex items-center gap-2">
                  <CheckCircle className="h-5 w-5" />
                  Low Priority: Healthy / No Acute Findings
                </h4>
                <p className="mt-2 text-sm">No urgent action required. Routine follow-up as clinically indicated.</p>
              </div>
            )}

            <div className="text-xs text-muted-foreground">
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
      )}
    </div>
  )
}
