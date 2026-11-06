import { ChevronDown, Info, MapPin } from "lucide-react"
import {
  AUSCULTATION_SITES,
  MIN_TAKES,
  MAX_TAKES,
  MIN_TAKE_SEC,
  MAX_TAKE_SEC,
  TARGET_TAKE_SEC_LOW,
  TARGET_TAKE_SEC_HIGH,
  TARGET_CYCLES_LOW,
  TARGET_CYCLES_HIGH,
  MIN_BREATHS_PER_POINT,
  RECOMMENDED_BREATHS_PER_POINT,
  siteByCode,
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
        <ChevronDown
          className="h-4 w-4 transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>

      <div className="space-y-5 border-t border-aura-border-soft px-4 pb-4 pt-4">
        {/* 1. Sites */}
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-aura-muted">
            1 · Where to listen
          </h4>
          <p className="mt-1.5 text-sm leading-relaxed text-aura-text">
            Use one point from the selected region for each take. The system
            scores every take separately and compares them, so repeated
            recordings from one spot add little.
          </p>
          <ol className="mt-2.5 grid gap-3 sm:grid-cols-2">
            {AUSCULTATION_SITES.map((site, i) => (
              <li key={site.code} className="flex min-w-0 gap-2.5 text-sm">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-aura-forest/10 text-[0.6875rem] font-semibold text-aura-forest">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="font-medium text-aura-ink">{site.name}</p>
                  <p className="mt-0.5 break-words text-xs leading-relaxed text-aura-muted">
                    {site.where}
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {site.points.map((point) => (
                      <li
                        key={point.name}
                        className="break-words text-xs leading-relaxed text-aura-muted"
                      >
                        <span className="font-medium text-aura-text">{point.name}</span>
                        {" — "}
                        {point.where}
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-2.5 flex gap-1.5 text-xs leading-relaxed text-aura-muted">
            <MapPin className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            At least {MIN_TAKES} takes are required. Use one Anterior and one
            Posterior; up to {MAX_TAKES} takes can cover more points and give a
            steadier result.
          </p>
        </section>

        {/* 2. Timing */}
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-aura-muted">
            2 · How long
          </h4>
          <p className="mt-1.5 text-sm leading-relaxed text-aura-text">
            Aim for <strong>{TARGET_CYCLES_LOW}–{TARGET_CYCLES_HIGH} full
            breaths</strong>, roughly {TARGET_TAKE_SEC_LOW}–
            {TARGET_TAKE_SEC_HIGH} seconds. Count the breaths rather than watching
            the clock — the clock is there to catch a take that is far too short
            or far too long, not to hit a number.
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-aura-text">
            Under {MIN_TAKE_SEC}s there are too few breaths to analyse reliably.
            Nothing stops you going longer, but past {MAX_TAKE_SEC}s it only
            adds upload time.
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
            <li>· Watch the level meter. Flat means nothing is arriving; into the red means it is clipping.</li>          </ul>
        </section>
      </div>
    </details>
  )
}

/**
 * The site selected for this take, with its placement instructions.
 *
 * It follows the dropdown rather than suggesting a site of its own, so the
 * instructions on screen always describe the place the take is about to be
 * recorded from. A card that recommended one site while the dropdown said
 * another put two different instructions on the same screen, and the clinician
 * had to work out which one the recording would follow.
 *
 * The site data already carries the placement text for every region -- the
 * detailed points, where they are, and how to get the diaphragm onto them -- so
 * both cards come from the one table in recording-protocol.ts rather than from
 * a second copy of the wording here.
 */
export function SiteDetail({
  code,
  takeNumber,
  lastSiteCode,
}: {
  code: string
  takeNumber: number
  lastSiteCode?: string
}) {
  const site = siteByCode(code)
  if (!site) return null

  const last = lastSiteCode ? siteByCode(lastSiteCode) : undefined
  const repeats = last?.code === site.code

  return (
    <div className="rounded-lg border border-aura-border-soft bg-aura-surface-alt p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-aura-muted">
            Take {takeNumber} · selected region
          </p>
          <p className="mt-1 text-base font-semibold text-aura-ink">{site.name}</p>
          <p className="mt-0.5 break-words text-xs leading-relaxed text-aura-muted">
            {site.where}
          </p>
        </div>
      </div>

      <ul className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
        {site.points.map((point) => (
          <li
            key={point.name}
            className="min-w-0 rounded-md border border-aura-border-soft/70 bg-white/70 px-2 py-1.5"
          >
            <p className="break-words text-xs font-medium leading-snug text-aura-ink">
              {point.name}
            </p>
            <p className="mt-0.5 break-words text-[0.6875rem] leading-snug text-aura-muted">
              {point.where}
            </p>
          </li>
        ))}
      </ul>

      <p className="mt-2 rounded-md border border-aura-border-soft bg-white/70 px-2 py-1.5 text-xs leading-relaxed text-aura-text">
        <span className="font-semibold text-aura-ink">Recommended:</span>{" "}
        {RECOMMENDED_BREATHS_PER_POINT} complete breaths (inhale + exhale) at this point.{" "}
        <span className="text-aura-muted">
          Minimum: {MIN_BREATHS_PER_POINT} full breath cycle before moving.
        </span>
      </p>

      <p className="mt-2 text-xs leading-relaxed text-aura-muted">{site.how}</p>

      {last && (
        <p
          className={cn(
            "mt-2.5 border-t border-aura-border-soft pt-2.5 text-xs leading-relaxed",
            repeats ? "text-amber-700" : "text-aura-muted"
          )}
        >
          {repeats
            ? `Your last take was also ${last.name}. Move to the other region or `
              + `a different point so this take adds new information.`
            : `Last take: ${last.name}. This one covers the other region — good.`}
        </p>
      )}

      <p className="mt-2 text-[0.6875rem] leading-relaxed text-aura-muted">
        Use one point from this region for this take. Change the selection above
        if you are recording somewhere else.
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
