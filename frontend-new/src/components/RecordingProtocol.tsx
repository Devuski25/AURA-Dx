import { Info, MapPin } from "lucide-react"
import {
  AUSCULTATION_SITES,
  MIN_TAKE_SEC,
  MAX_TAKE_SEC,
  TARGET_TAKE_SEC,
  siteByCode,
  suggestedSite,
} from "@/lib/recording-protocol"
import { cn } from "@/lib/utils"

/**
 * The recording protocol, written out.
 *
 * Shown before capture starts and referenced per take. Every number here comes
 * from `recording-protocol.ts`, so the guide and the live guidance cannot
 * disagree -- a separate copy of these figures in the UI is exactly how a
 * protocol drifts out of sync with itself.
 *
 * Nothing on this card blocks a recording. A clinician who is behind should be
 * able to ignore all of it and still complete a screening.
 */

export function RecordingProtocolCard({ className }: { className?: string }) {
  return (
    <details
      className={cn(
        "group rounded-lg border border-aura-border-soft bg-aura-surface-alt",
        className
      )}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 text-sm font-medium text-aura-ink marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-aura-forest">
        <span className="flex items-center gap-2">
          <Info className="h-4 w-4 text-aura-forest" aria-hidden="true" />
          How to record — sites, timing, technique
        </span>
        <span
          className="text-xs text-aura-muted transition-transform group-open:rotate-180"
          aria-hidden="true"
        >
          ▾
        </span>
      </summary>

      <div className="space-y-5 border-t border-aura-border-soft px-4 pb-4 pt-4">
        {/* 1. Sites */}
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-aura-muted">
            1 · Where to listen
          </h4>
          <p className="mt-1.5 text-sm leading-relaxed text-aura-text">
            Move the stethoscope to a different place for each take. The system
            scores every take separately and compares them, so five recordings
            from one spot carry no more information than one.
          </p>
          <ol className="mt-2.5 space-y-2">
            {AUSCULTATION_SITES.map((site, i) => (
              <li key={site.code} className="flex gap-2.5 text-sm">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-aura-forest/10 text-[0.6875rem] font-semibold text-aura-forest">
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className="font-medium text-aura-ink">{site.name}</span>
                  <span className="text-aura-muted"> — {site.how}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-2.5 flex gap-1.5 text-xs leading-relaxed text-aura-muted">
            <MapPin className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            Recording three is the minimum. Five covers all five sites and gives
            the most reliable result.
          </p>
        </section>

        {/* 2. Timing */}
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-aura-muted">
            2 · How long
          </h4>
          <p className="mt-1.5 text-sm leading-relaxed text-aura-text">
            Aim for about <strong>{TARGET_TAKE_SEC} seconds</strong> each — roughly
            3 to 4 full breaths. Under {MIN_TAKE_SEC}s there are too few breathing
            cycles to analyse reliably, so a very short take gets rejected rather
            than scored. Nothing stops you going longer, but past{" "}
            {MAX_TAKE_SEC}s it only adds upload time.
          </p>
        </section>

        {/* 3. Technique */}
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-aura-muted">
            3 · Technique
          </h4>
          <ul className="mt-1.5 space-y-1.5 text-sm leading-relaxed text-aura-text">
            <li>· Have the patient sit upright and breathe quietly through the mouth.</li>
            <li>· Seal the chestpiece. Air leaking in is the most common cause of a poor take.</li>
            <li>· Keep the room quiet. Fan, air-conditioning and chatter all show up in the recording.</li>
            <li>· Hold still. Rustling fabric and moving the tube produce sounds that read as abnormal.</li>
            <li>· Watch the level meter. Flat means nothing is arriving; into the red means it is clipping.</li>
          </ul>
        </section>
      </div>
    </details>
  )
}

/** Compact per-take reminder. Shows the last take's site so repeating one is visible. */
export function SitePrompt({
  takenCount,
  lastSiteCode,
}: {
  takenCount: number
  lastSiteCode?: string
}) {
  const site = suggestedSite(takenCount)
  const last = lastSiteCode ? siteByCode(lastSiteCode) : undefined
  const repeats = last?.code === site.code

  return (
    <div className="rounded-lg border border-aura-border-soft bg-aura-surface-alt p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-aura-muted">
            Take {Math.min(takenCount + 1, 5)} · suggested site
          </p>
          <p className="mt-1 text-base font-semibold text-aura-ink">{site.name}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-aura-muted">
            {site.where}. {site.how}
          </p>
        </div>
      </div>

      {last && (
        <p
          className={cn(
            "mt-2.5 border-t border-aura-border-soft pt-2.5 text-xs",
            repeats ? "text-amber-700" : "text-aura-muted"
          )}
        >
          {repeats
            ? `Your last take was also ${last.name}. If you listen from the same `
              + `place, this adds nothing — try a different site.`
            : `Last take: ${last.name}. Different from this one — good.`}
        </p>
      )}

      <p className="mt-2 text-[0.6875rem] leading-relaxed text-aura-muted">
        A suggestion, not a requirement. Record wherever is clinically right.
      </p>
    </div>
  )
}

/** Per-take badge in the recorded list. */
export function SiteChip({ code }: { code?: string }) {
  const site = code ? siteByCode(code) : undefined
  if (!site) return null
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-aura-forest/10 px-2 py-0.5 text-[0.6875rem] font-medium text-aura-forest">
      <MapPin className="h-2.5 w-2.5" aria-hidden="true" />
      {site.name}
    </span>
  )
}
