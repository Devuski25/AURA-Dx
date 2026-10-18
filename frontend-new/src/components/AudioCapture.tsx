import { useCallback, useEffect, useRef, useState } from "react"
import { AlertTriangle, Loader2, Mic, MicOff, Play, RefreshCw, Volume2 } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Real input level, from the actual audio stream.
 *
 * The equalizer this replaces animated on a timer. It moved identically whether
 * audio was arriving or not, so a muted or unplugged stethoscope looked exactly
 * like a working one -- the single most misleading thing on a capture screen,
 * because the clinician has no way to tell they are recording silence until
 * they delete the take.
 *
 * `AnalyserNode` gives the true peak of what the device is producing. Silence
 * now looks like silence.
 */

export interface InputDevice {
  deviceId: string
  label: string
  /** Heuristic, not truth: browsers rarely expose the device class. */
  looksLikeStethoscope: boolean
}

const STETHOSCOPE_HINTS =
  /steth|echo|eko|littmann|3m|electronic|thinklabs|mount|dsp|amplifier/i

/**
 * Browser labels are empty strings until permission has been granted once, so
 * the first enumerate returns unnamed devices. `useAudioInput` asks for the
 * stream up front purely to unlock them.
 */

export function useAudioInput() {
  const [devices, setDevices] = useState<InputDevice[]>([])
  const [selectedId, setSelectedId] = useState<string>("")
  const [permission, setPermission] = useState<
    "unknown" | "granted" | "denied" | "unsupported"
  >("unknown")
  const [level, setLevel] = useState(0)
  const [clipped, setClipped] = useState(false)

  const analyserRef = useRef<AnalyserNode | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const smoothedRef = useRef(0)

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setPermission("unsupported")
      return
    }
    const list = await navigator.mediaDevices.enumerateDevices()
    const inputs = list.filter((d) => d.kind === "audioinput")
    const mapped = inputs.map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label || `Audio input ${i + 1}`,
      looksLikeStethoscope: STETHOSCOPE_HINTS.test(d.label),
    }))
    setDevices(mapped)

    /* Pick something, but never "nothing".
     *
     * A stethoscope-shaped label wins. Failing that, if there is exactly one
     * input it is almost certainly the stethoscope, so take it. With two or
     * more and no identifiable label, leave the choice to the clinician rather
     * than guessing -- because guessing wrong here is how a take gets recorded
     * from the laptop microphone instead.
     *
     * Previously selectedId started empty and stayed empty until someone used
     * the dropdown, so the default input was used for every capture. */
    setSelectedId((prev) => {
      if (prev && mapped.some((d) => d.deviceId === prev)) return prev
      const hinted = mapped.find((d) => d.looksLikeStethoscope)
      if (hinted) return hinted.deviceId
      if (mapped.length === 1) return mapped[0].deviceId
      return ""
    })

    return inputs
  }, [])

  /** Ask once for permission, then enumerate. Labels are empty until granted. */
  useEffect(() => {
    let cancelled = false
    const init = async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        setPermission("granted")
        // Handed straight back: this only exists to unlock device labels and
        // the permission prompt. The real capture opens its own stream so a
        // device change can swap it without a second permission prompt.
        s.getTracks().forEach((t) => t.stop())
        await refreshDevices()
      } catch (err) {
        if (cancelled) return
        const name = (err as DOMException)?.name
        setPermission(
          name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unknown"
        )
      }
    }
    void init()
    return () => {
      cancelled = true
    }
  }, [refreshDevices])

  useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener) return
    const onChange = () => void refreshDevices()
    navigator.mediaDevices.addEventListener("devicechange", onChange)
    return () => navigator.mediaDevices.removeEventListener("devicechange", onChange)
  }, [refreshDevices])

  /** Open the capture stream and wire the analyser to it. */
  const open = useCallback(
    async (deviceId?: string) => {
      await close()
      const constraints: MediaStreamConstraints = {
        audio: {
          // No sample rate or channel count is requested. The capture is
          // resampled to 16 kHz mono downstream, and pinning values here only
          // risks the browser refusing a device that would otherwise work.
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream

      const ctx = new AudioContext()
      ctxRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      // Fast attack, slow release, so a cough reads as a spike and the bar does
      // not flicker between breaths.
      analyser.smoothingTimeConstant = 0.6
      source.connect(analyser)
      analyserRef.current = analyser

      const track = stream.getAudioTracks()[0]
      const actualId = track?.getSettings?.().deviceId
      if (actualId) setSelectedId(actualId)

      const data = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        analyser.getByteTimeDomainData(data)
        let peak = 0
        for (let i = 0; i < data.length; i++) {
          const v = Math.abs(data[i] - 128) / 128
          if (v > peak) peak = v
        }
        // Asymmetric smoothing: jump up immediately, fall slowly.
        smoothedRef.current =
          peak > smoothedRef.current ? peak : smoothedRef.current * 0.86 + peak * 0.14
        setLevel(smoothedRef.current)
        setClipped(smoothedRef.current > 0.97)
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)

      // A device unplugged mid-capture fires this; without a handler the
      // recording silently continues on nothing.
      track?.addEventListener("ended", () => void close())

      return stream
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedId]
  )

  const close = useCallback(async () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (ctxRef.current && ctxRef.current.state !== "closed") await ctxRef.current.close()
    ctxRef.current = null
    analyserRef.current = null
    smoothedRef.current = 0
    setLevel(0)
    setClipped(false)
  }, [])

  useEffect(() => {
    return () => {
      void close()
    }
  }, [close])

  const device = devices.find((d) => d.deviceId === selectedId)

  /* Which input are we actually going to record from?
   *
   * Until something is chosen here, this is empty -- and an empty selection
   * means getUserMedia picks the SYSTEM DEFAULT, which on a laptop is the
   * built-in microphone. That is the failure this whole component exists to
   * prevent: a clinician records three to five takes of room noise, the model
   * classifies it confidently, and nothing anywhere says the stethoscope was
   * never plugged in.
   *
   * So the default is never used for capture. A stethoscope-looking input is
   * selected automatically; failing that, a lone input is. When two or more
   * are present and none is identifiable, `ready` stays false and the record
   * button stays disabled until the clinician picks -- which is a deliberate
   * thirty seconds of friction in exchange for not silently recording the
   * wrong thing. */
  /* `ready` is the gate that matters: without an explicit device chosen,
   * capture would silently fall back to the system default input. */
  const ready = permission === "granted" && !!device
  const activeLabel = device?.label ?? null

  return {
    devices,
    device,
    selectedId,
    setSelectedId,
    permission,
    level,
    clipped,
    refreshDevices,
    open,
    close,
    /** True when an explicit input has been chosen and capture may start. */
    ready,
    /** The label of the input actually being recorded from. */
    activeLabel,
    /** No device was chosen, so capture would fall back to the system default. */
    needsDeviceChoice: permission === "granted" && devices.length > 0 && !device,
  }
}

/* ------------------------------------------------------------------------- */

export function DeviceBanner({
  devices,
  device,
  permission,
  selectedId,
  onSelect,
  onRefresh,
}: {
  devices: InputDevice[]
  device?: InputDevice
  permission: string
  selectedId: string
  onSelect: (id: string) => void
  onRefresh: () => void
}) {
  const tone =
    permission === "denied"
      ? "border-red-200 bg-red-50"
      : device?.looksLikeStethoscope
        ? "border-aura-pine/25 bg-aura-pine/5"
        : "border-amber-200 bg-amber-50"

  const headline =
    permission === "denied"
      ? "Microphone blocked"
      : permission === "unsupported"
        ? "Audio input unavailable"
        : !device
          ? "Looking for an audio input…"
          : device.looksLikeStethoscope
            ? "Digital stethoscope connected"
            : devices.length === 0
              ? "No audio input detected"
              : "Using a built-in microphone"

  const detail =
    permission === "denied"
      ? "Allow microphone access in the browser, then try again. Without it no take can be recorded."
      : device?.looksLikeStethoscope
        ? device.label
        : devices.length > 1
          ? "No stethoscope found among the connected inputs. Recordings will use whichever one is selected below."
          : device?.label ?? "Connect a stethoscope, then refresh."

  return (
    <div className={cn("rounded-lg border p-3.5", tone)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 shrink-0">
            {permission === "denied" ? (
              <MicOff className="h-4 w-4 text-red-700" aria-hidden="true" />
            ) : device?.looksLikeStethoscope ? (
              <Mic className="h-4 w-4 text-aura-pine" aria-hidden="true" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-amber-700" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-aura-ink">{headline}</p>
            <p className="mt-0.5 break-words text-xs leading-relaxed text-aura-muted">
              {detail}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="shrink-0 rounded-md p-1.5 text-aura-muted transition-colors hover:bg-black/5 hover:text-aura-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-forest"
          aria-label="Refresh audio inputs"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      {devices.length > 1 && (
        <div className="mt-3">
          <label
            htmlFor="aura-input-device"
            className="block text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-aura-muted"
          >
            Audio input
          </label>
          <select
            id="aura-input-device"
            value={selectedId}
            onChange={(e) => onSelect(e.target.value)}
            className="mt-1.5 h-11 w-full rounded-lg border border-aura-border bg-white px-2.5 text-sm text-aura-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-forest"
          >
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
                {d.looksLikeStethoscope ? " — stethoscope" : ""}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}

/** True input level. Silence renders as a flat line, not a decorative wave. */
export function LevelMeter({
  level,
  clipped,
  active,
}: {
  level: number
  clipped: boolean
  active: boolean
}) {
  const pct = Math.round(Math.min(1, level) * 100)
  return (
    <div
      role="meter"
      aria-label="Microphone input level"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={active ? `${pct} percent` : "Not recording"}
      className="relative h-14 w-full overflow-hidden rounded-lg border border-aura-border-soft bg-aura-surface-alt"
    >
      {/* Clipping band: above about -3 dBFS the waveform is distorted, and a
          distorted take still gets scored as though it were clean. */}
      <div className="absolute inset-y-0 right-0 w-[8%] bg-red-500/15" aria-hidden="true" />

      <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-75",
            clipped
              ? "bg-red-500"
              : pct > 70
                ? "bg-amber-500"
                : pct > 3
                  ? "bg-aura-pine"
                  : "bg-aura-muted/40"
          )}
          style={{ width: `${Math.max(pct, pct > 3 ? 3 : 0)}%` }}
        />
      </div>

      {!active && (
        <p className="absolute inset-0 flex items-center justify-center text-xs text-aura-muted">
          Microphone idle
        </p>
      )}

      {clipped && active && (
        /* Full-width strip at the top rather than a centred line at the bottom:
           on a 375px screen a centred sentence wrapped to three lines and
           overlapped the meter bar. */
        <p className="absolute inset-x-0 top-0 bg-red-500/90 px-2 py-0.5 text-center text-[0.6875rem] font-semibold text-white">
          Too loud — move the stethoscope
        </p>
      )}
    </div>
  )
}

/**
 * Prove the audio is coming from the stethoscope.
 *
 * Software cannot tell a stethoscope from a laptop microphone -- both arrive as
 * an opaque `MediaStreamTrack` labelled only by whatever the OS called them, and
 * `looksLikeStethoscope` is a regex over that label, so it is a guess. A
 * confident guess is worse than an honest check.
 *
 * So this does the one thing that genuinely settles it: records five seconds
 * from the selected input and plays it back. A clinician hears a chest through
 * the stethoscope, or hears a room. Nobody has to take the label on faith, and
 * nobody has to trust a regex.
 *
 * Deliberately not a take. Nothing is added to the screening and nothing is
 * uploaded -- it never leaves the browser.
 *
 * Shown on phone, tablet and desktop alike. On a phone this matters most: a
 * built-in mic is the default input everywhere, and on a phone the laptop-mic
 * mistake is the easiest one to make by accident.
 */
export function StethoscopeCheck({
  devices,
  device,
  permission,
  selectedId,
  level,
  onSelect,
  onRefresh,
}: {
  devices: InputDevice[]
  device?: InputDevice
  permission: string
  selectedId: string
  level: number
  onSelect: (id: string) => void
  onRefresh: () => void
}) {
  const [testing, setTesting] = useState(false)
  const [remaining, setRemaining] = useState(0)
  const [takeUrl, setTakeUrl] = useState<string | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const timerRef = useRef<number | null>(null)

  const TEST_SEC = 5

  // Object URLs are per-recording; releasing the previous one matters because
  // this panel can be used several times in a session and each holds the whole
  // clip in memory.
  useEffect(() => {
    return () => {
      if (takeUrl) URL.revokeObjectURL(takeUrl)
      if (timerRef.current) window.clearInterval(timerRef.current)
      void ctxRef.current?.close()
    }
  }, [takeUrl])

  const stop = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    void ctxRef.current?.close()
    ctxRef.current = null
  }, [])

  const runTest = useCallback(async () => {
    if (!selectedId || testing) return
    stop()
    if (takeUrl) {
      URL.revokeObjectURL(takeUrl)
      setTakeUrl(null)
    }
    setTesting(true)
    setRemaining(TEST_SEC)

    let stream: MediaStream
    try {
      // Always an explicit deviceId. An empty one falls back to the system
      // default, which is the exact situation this panel exists to rule out.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: selectedId },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })
    } catch {
      setTesting(false)
      setRemaining(0)
      return
    }

    const ctx = new AudioContext()
    ctxRef.current = ctx

    /* MediaRecorder rather than tapping the PCM buffers.
     *
     * ScriptProcessorNode is deprecated, and its AudioBuffer is not a BlobPart,
     * so it would have needed a hand-rolled WAV header to produce anything
     * playable. MediaRecorder gives a real container directly and the clip only
     * has to be heard -- never scored, never uploaded. */
    let recorder: MediaRecorder
    try {
      recorder = new MediaRecorder(stream)
    } catch {
      void ctx.close()
      ctxRef.current = null
      setTesting(false)
      setRemaining(0)
      return
    }

    const parts: BlobPart[] = []
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) parts.push(e.data)
    }
    recorder.onstop = () => {
      const blob = new Blob(parts, { type: recorder.mimeType || "audio/webm" })
      parts.length = 0
      setTakeUrl(blob.size > 0 ? URL.createObjectURL(blob) : null)
    }
    recorder.start()

    timerRef.current = window.setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          if (timerRef.current) window.clearInterval(timerRef.current)
          timerRef.current = null
          try {
            recorder.stop()
          } catch {
            /* already stopped */
          }
          stop()
          setTesting(false)
          return 0
        }
        return r - 1
      })
    }, 1000)
  }, [selectedId, testing, stop, takeUrl])

  const hasDevice = !!device
  const tone = !hasDevice
    ? "border-amber-200 bg-amber-50"
    : device?.looksLikeStethoscope
      ? "border-aura-pine/25 bg-aura-pine/5"
      : "border-amber-200 bg-amber-50"

  return (
    <div className={cn("rounded-lg border p-3.5", tone)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-aura-ink">Stethoscope check</p>
          <p className="mt-0.5 text-xs leading-relaxed text-aura-muted">
            {permission === "denied"
              ? "Allow microphone access in the browser to run this check."
              : !hasDevice
                ? "Choose your stethoscope from Audio input below first."
                : "Record five seconds and play it back. You should hear the chest through the stethoscope, not the room."}
          </p>
        </div>
      </div>

      {/* The device that will actually be used, named. */}
      <div className="mt-3 rounded-md bg-white/70 px-2.5 py-2">
        <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-aura-muted">
          Recording from
        </p>
        <p className="mt-0.5 break-words text-sm font-medium text-aura-ink">
          {device?.label ?? "No input selected"}
        </p>
        {hasDevice && !device?.looksLikeStethoscope && (
          <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            This does not look like a stethoscope. Play the test recording back —
            if you hear a room, the wrong input is selected.
          </p>
        )}
      </div>

      {/* Live level, so silence is visibly different from a dead connection. */}
      <div className="mt-2.5">
        <LevelMeter level={level} clipped={false} active={hasDevice} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void runTest()}
          disabled={!hasDevice || testing}
          className="inline-flex h-11 items-center gap-2 rounded-lg bg-aura-forest px-3.5 text-sm font-semibold text-white transition-colors hover:bg-aura-pine focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-forest disabled:opacity-50"
        >
          {testing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Recording… {remaining}s
            </>
          ) : (
            <>
              <Play className="h-4 w-4" aria-hidden="true" />
              Record 5s test
            </>
          )}
        </button>

        {takeUrl && (
          <button
            type="button"
            onClick={() => {
              const el = new Audio(takeUrl)
              void el.play()
            }}
            className="inline-flex h-11 items-center gap-2 rounded-lg border border-aura-border bg-white px-3.5 text-sm font-semibold text-aura-ink transition-colors hover:bg-aura-mint-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-forest"
          >
            <Volume2 className="h-4 w-4" aria-hidden="true" />
            Play it back
          </button>
        )}

        <button
          type="button"
          onClick={onRefresh}
          className="ml-auto rounded-md p-2 text-aura-muted transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-forest"
          aria-label="Refresh audio inputs"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {devices.length > 1 && (
        <div className="mt-3">
          <label
            htmlFor="aura-check-device"
            className="block text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-aura-muted"
          >
            Audio input
          </label>
          <select
            id="aura-check-device"
            value={selectedId}
            onChange={(e) => onSelect(e.target.value)}
            className="mt-1.5 h-11 w-full rounded-lg border border-aura-border bg-white px-2.5 text-sm text-aura-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-forest"
          >
            <option value="">Choose…</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
                {d.looksLikeStethoscope ? " — stethoscope" : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      <p className="mt-2.5 text-[0.6875rem] leading-relaxed text-aura-muted">
        This test is never saved and never uploaded. It only plays back here, in
        your browser.
      </p>
    </div>
  )
}
