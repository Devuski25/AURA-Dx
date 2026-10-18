import { useCallback, useEffect, useRef, useState } from "react"
import { AlertTriangle, Mic, MicOff, RefreshCw } from "lucide-react"
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
    setDevices(
      inputs.map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || `Audio input ${i + 1}`,
        looksLikeStethoscope: STETHOSCOPE_HINTS.test(d.label),
      }))
    )
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
            className="mt-1.5 h-10 w-full rounded-lg border border-aura-border bg-white px-2.5 text-sm text-aura-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-forest"
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
        <p className="absolute inset-x-0 bottom-1 text-center text-[0.6875rem] font-semibold text-red-700">
          Too loud — move the stethoscope or speak less
        </p>
      )}
    </div>
  )
}
