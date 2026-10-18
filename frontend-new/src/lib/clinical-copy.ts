import copy from "@shared/clinical_copy.json"

/**
 * Clinical result wording.
 *
 * Imported from `shared/clinical_copy.json`, which backend/pdf_copy.py reads
 * from the same file. That is the whole point of the file existing: the screen
 * and the printed report must not be able to drift apart, because a patient
 * whose result reads one way on screen and another way on paper is a worse
 * problem than either wording being imperfect.
 *
 * The database stores `recommendation_code` -- a key like "COPD_HIGH" -- rather
 * than prose, so rewording a message never needs a migration.
 */

export type Status = "HEALTHY" | "COPD" | "PNEUMONIA" | "ATYPICAL_OOD"
export type ConfidenceLevel = "HIGH" | "MODERATE" | "LOW"

/** What the inference service returns inside a screening result. */
export interface Interpretation {
  status: Status
  confidence_level: ConfidenceLevel
  decision_rule: string
  decision_detail: string
  band_metric: string
  band_position: number
  low_agreement: boolean
  agreement_std: number
  recordings_total: number
  recordings_flagged: number
}

type Section = Record<string, string>

/* The JSON carries `_comment` keys alongside the real data, so the shape is
   narrowed here rather than at every use site. */
const w = copy as unknown as {
  version: string
  status: Record<Status, { label: string; badgeTone: string }>
  confidence: Record<ConfidenceLevel, string>
  headline: Section
  message: Section
  recommendation: Section
  disclosure: Section
}

/** Stable key into the copy tables: "COPD" + "HIGH" -> "COPD_HIGH". */
export function copyKey(status: string, level: string): string {
  return `${status}_${level}`
}

function pick(section: Section, key: string, fallback: string): string {
  return section[key] ?? fallback
}

export function statusLabel(status: string): string {
  return w.status[status as Status]?.label ?? status
}

export function badgeTone(status: string): string {
  return w.status[status as Status]?.badgeTone ?? "slate"
}

export function confidenceLabel(level: string): string {
  return w.confidence[level as ConfidenceLevel] ?? level
}

/**
 * Resolve the three user-facing strings for a result.
 *
 * Falls back to the status-only key when an unexpected confidence level turns
 * up, rather than rendering `undefined` into a patient-facing sentence.
 */
export function resultCopy(status: string, level: string) {
  const key = copyKey(status, level)
  const fallback = copyKey(status, "HIGH")
  return {
    headline: pick(w.headline, key, pick(w.headline, fallback, statusLabel(status))),
    message: pick(w.message, key, pick(w.message, fallback, "")),
    recommendation: pick(
      w.recommendation,
      key,
      pick(w.recommendation, fallback, w.disclosure.scope)
    ),
  }
}

export const DISCLOSURE = w.disclosure
