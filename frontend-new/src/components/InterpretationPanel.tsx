import { AlertTriangle, CheckCircle2, CircleHelp, Info, Loader2 } from "lucide-react"
import {
  DISCLOSURE,
  badgeTone,
  confidenceLabel,
  resultCopy,
  statusLabel,
} from "@/lib/clinical-copy"
import { cn } from "@/lib/utils"

/**
 * The clinical reading of a screening result.
 *
 * Sits above the probability bars because it is what a clinician acts on. The
 * bars are the evidence; this is the conclusion.
 *
 * Every string here comes from `shared/clinical_copy.json`, the same file the PDF
 * generator reads, so the screen and the printed report cannot describe a
 * finding differently.
 *
 * The scope disclaimer is not optional and not dismissible. This system was
 * trained on three classes only, so it has no output for asthma, bronchitis,
 * URTI, heart failure or anything else. A reader who does not know that will
 * hear "not COPD and not pneumonia" as "nothing is wrong", which is the single
 * most dangerous misreading this screen could produce.
 */

type Props = {
  className?: string
  status: string | null
  level: string | null
  decisionRule: string | null
  decisionDetail: string | null
  lowAgreement: boolean | null
  recordingsTotal: number | null
  recordingsFlagged: number | null
}

const TONE_STYLES: Record<string, string> = {
  green: "border-aura-pine/25 bg-aura-pine/10 text-aura-pine",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  red: "border-red-200 bg-red-50 text-red-800",
  slate: "border-aura-border bg-aura-surface-alt text-aura-text",
}

const LEVEL_STYLES: Record<string, string> = {
  HIGH: "border-aura-pine/25 bg-aura-pine/10 text-aura-pine",
  MODERATE: "border-amber-200 bg-amber-50 text-amber-800",
  LOW: "border-aura-border bg-white text-aura-muted",
}

const RULE_TEXT: Record<string, string> = {
  safety_override: "Set by a single recording",
  majority_healthy_confident: "Majority of recordings normal",
  majority_healthy: "Majority of recordings normal",
  borderline_healthy: "Borderline — majority normal",
  conditional_copd_high: "Averaged across the disease-screen recordings",
  conditional_copd_moderate: "Averaged across the disease-screen recordings",
  conditional_undecidable: "Undecidable — averaged across the disease-screen recordings",
}

export function InterpretationPanel({
  className,
  status,
  level,
  decisionRule,
  decisionDetail,
  lowAgreement,
  recordingsTotal,
  recordingsFlagged,
}: Props) {
  // Rows created before the interpretation layer have no status. They still get
  // the probability bars and the classifier card; this panel simply stays out of
  // the way rather than inventing a confidence level for a result that never had
  // one computed.
  if (!status || !level) return null

  const tone = badgeTone(status)
  const copy = resultCopy(status, level)
  const flaggedCount = recordingsFlagged ?? 0
  const totalCount = recordingsTotal ?? 0
  const isOverride = decisionRule === "safety_override"

  return (
    <section
      aria-label="Clinical interpretation"
      className={cn(
        "rounded-2xl border border-aura-border bg-white p-4 shadow-aura-xs sm:p-5",
        className
      )}
    >
      {/* Verdict

          On a phone the heading takes the whole line and the confidence pill
          sits under it.

          They used to share a line, and the heading was the one that gave
          way: it can shrink, so it did, and a heading squeezed into 150px
          puts one word on each line. Letting the heading claim the full
          width and pushing the pill down means neither of them is ever
          squeezed. From `sm` up there is room for both, and they share the
          line as before. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 basis-full sm:basis-auto">
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-aura-muted">
            Screening result
          </p>
          <h3 className="mt-1 font-display text-lg font-semibold leading-tight text-balance text-aura-ink sm:text-2xl">
            {statusLabel(status)}
          </h3>
          <p className="mt-1 text-[13.5px] leading-relaxed text-pretty text-aura-text sm:text-sm">
            {copy.headline}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
            LEVEL_STYLES[level] ?? LEVEL_STYLES.LOW
          )}
        >
          {level === "HIGH" ? (
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          ) : level === "MODERATE" ? (
            <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {confidenceLabel(level)}
        </span>
      </div>

      <p className="mt-2.5 text-[13.5px] leading-relaxed text-pretty text-aura-text sm:text-sm">
        {copy.message}
      </p>

      {/* What to do next. The most prominent line on the panel. */}
      <div
        className={cn(
          "mt-3 rounded-xl border p-3.5",
          tone === "red" ? TONE_STYLES.red : tone === "amber" ? TONE_STYLES.amber : TONE_STYLES.slate
        )}
      >
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] opacity-75">
          Suggested next step
        </p>
        <p className="mt-1 text-[13.5px] font-medium leading-relaxed text-pretty sm:text-sm">
          {copy.recommendation}
        </p>
      </div>

      {/* How the verdict was reached.

          The label and its value stack, on every width.

          They used to sit side by side on a phone, pushed apart with
          `justify-between`, which left the value a narrow column at the right
          edge. "Majority of recordings normal" then had about nine words to
          fit into it, so it came out one word per line -- a column of
          single words with the label stranded on the left. The label above
          the value is how the same pair reads on the screens above it, and
          it is the only arrangement that fits. */}
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-[13.5px] sm:grid-cols-2 sm:text-sm">
        {totalCount > 0 && (
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-aura-muted">Recordings</dt>
            <dd className="font-medium text-aura-ink">
              {flaggedCount} of {totalCount} reached the disease screen
            </dd>
          </div>
        )}
        {decisionRule && (
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-aura-muted">Decided by</dt>
            <dd className="font-medium text-aura-ink">
              {RULE_TEXT[decisionRule] ?? decisionRule}
            </dd>
          </div>
        )}
      </dl>

      {decisionDetail && (
        <p className="mt-2.5 text-xs leading-relaxed text-aura-muted">{decisionDetail}</p>
      )}

      {/* Warnings. Each one is a specific, different situation, so each gets its
          own line rather than being folded into a generic caveat. */}
      {(isOverride || lowAgreement || (flaggedCount > 0 && status === "HEALTHY")) && (
        <ul className="mt-3 flex list-none flex-col gap-2 p-0">
          {isOverride && (
            <li className="flex gap-2 rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0">{DISCLOSURE.override}</span>
            </li>
          )}
          {lowAgreement && (
            <li className="flex gap-2 rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0">{DISCLOSURE.lowAgreement}</span>
            </li>
          )}
          {flaggedCount > 0 && status === "HEALTHY" && (
            <li className="flex gap-2 rounded-lg bg-aura-surface-alt p-3 text-xs leading-relaxed text-aura-text">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0">{DISCLOSURE.borderlineCount}</span>
            </li>
          )}
        </ul>
      )}

      {/* Always shown. Not a disclaimer to be dismissed -- the scope of the
          model is a fact about what the number means.

          The text sits in a flex row beside an icon, so it needs `min-w-0` to
          be allowed to shrink: a flex item keeps its widest word as its
          minimum width otherwise, and a long word in the disclaimer would
          push past the edge of the card instead of wrapping. */}
      <p className="mt-3 flex gap-2 border-t border-aura-border-soft pt-3 text-xs leading-relaxed text-aura-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0">{DISCLOSURE.scope}</span>
      </p>
    </section>
  )
}

/** Compact badge for list rows, where there is no room for the full panel. */
export function StatusBadge({ status, level }: { status: string; level?: string | null }) {
  const tone = badgeTone(status)
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn(
          "inline-flex h-6 whitespace-nowrap items-center rounded-full border px-2 text-xs font-semibold capitalize",
          TONE_STYLES[tone] ?? TONE_STYLES.slate
        )}
      >
        {statusLabel(status)}
      </span>
      {level && (
        <span className="text-[0.6875rem] text-aura-muted">{confidenceLabel(level)}</span>
      )}
    </span>
  )
}

/** Loading placeholder, used where a result is still being interpreted. */
export function InterpretationPending() {
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-aura-border bg-white p-5 text-sm text-aura-muted">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      Interpreting result…
    </div>
  )
}
