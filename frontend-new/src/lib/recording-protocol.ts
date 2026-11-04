/**
 * Recording protocol.
 *
 * WHICH SITES
 * The training corpus recorded at named anatomical locations -- anterior left,
 * anterior right, posterior left, posterior right, trachea -- using the
 * Al / Ar / Pl / Pr / Tr codes that appear in the dataset filenames. The fusion
 * rule that lets one alarming take override four reassuring ones exists because
 * lung pathology is audible at one site and inaudible at another. That safety
 * net is worthless if every take comes from the same spot, because then the
 * takes are copies of one recording and the average is theatre.
 *
 * The capture screen now keeps the dropdown to the two regions a clinician
 * actually compares: Anterior and Posterior. The detailed points below are the
 * placement guide for each region, so the control stays short without losing
 * the exact intercostal space or vertebral level. One take uses one point from
 * the selected region; the recommended minimum is one Anterior and one
 * Posterior take, and up to five takes can cover more points.
 *
 * SUGGESTED, NEVER REQUIRED
 * A clinician under a queue who is blocked from recording has no way to complete
 * a screening at all. So the region is shown, the previous take's region is
 * shown beside it, and nothing stops them recording wherever is clinically right.
 * The guidance works by being visible, not by being enforced.
 *
 * HOW LONG
 * Training recordings ran 10 to 90 seconds. Below eight seconds the log-mel
 * window covers too few breathing cycles for the feature set to mean anything,
 * so a very short take is not a slightly worse take -- it is an unusable one.
 */

export type AuscultationPoint = {
  readonly name: string
  readonly where: string
}

export type AuscultationSite = {
  readonly code: "A" | "P"
  readonly name: "Anterior" | "Posterior"
  readonly where: string
  readonly how: string
  readonly points: readonly AuscultationPoint[]
}

/** The two regions in the site dropdown, with their detailed auscultation points. */
export const AUSCULTATION_SITES: readonly AuscultationSite[] = [
  {
    code: "A",
    name: "Anterior",
    where: "Front of the chest · 2nd and 4th intercostal spaces (ICS), mid-clavicular line",
    how: "Patient sitting upright, arms relaxed. Place the diaphragm flat on the named "
       + "intercostal space, keeping it over the rib space rather than angled across a "
       + "rib. Use the same light pressure on both sides.",
    points: [
      { name: "Right Anterior Upper Lobe", where: "2nd ICS, mid-clavicular line" },
      { name: "Left Anterior Upper Lobe", where: "2nd ICS, symmetric" },
      { name: "Right Middle Lobe Field", where: "4th ICS / nipple line, mid-clavicular line" },
      { name: "Left Anterior Lower Division / Lingular Field", where: "4th ICS, symmetric" },
    ],
  },
  {
    code: "P",
    name: "Posterior",
    where: "Back · apex (T2-T3), mid-field (T4-T5) and base (T7-T8) on both sides",
    how: "Patient sits leaning slightly forward with arms crossed. Place the diaphragm "
       + "flat against the back, 2 cm lateral to the spine at the apex and along the "
       + "medial border of the scapula lower down. Keep the same pressure on both sides.",
    points: [
      { name: "Right Posterior Apex", where: "T2-T3, 2 cm lateral to spinous process" },
      { name: "Left Posterior Apex", where: "T2-T3, symmetric" },
      { name: "Right Mid-Posterior Field / Upper-Lower Lobe Interface", where: "T4-T5, medial border of scapula" },
      { name: "Left Mid-Posterior Field / Upper-Lower Lobe Interface", where: "T4-T5, symmetric" },
      { name: "Right Posterior Base", where: "T7-T8, mid-scapular line below inferior angle" },
      { name: "Left Posterior Base", where: "T7-T8, symmetric" },
    ],
  },
]

export type Site = AuscultationSite
export type SiteCode = Site["code"]

export function siteByCode(code: string): Site | undefined {
  return AUSCULTATION_SITES.find((s) => s.code === code)
}

/* Two regions means two takes: one Anterior and one Posterior. MAX_TAKES stays
 * at five so a clinician can add points within a region when it is clinically
 * useful, without turning the capture screen into a ten-step checklist. */
export const MIN_TAKES = 2
export const MAX_TAKES = 5

/* --- Duration ------------------------------------------------------------
 * FLOOR: below this there are too few breathing cycles for the feature set to
 * mean anything. A very short take is not a slightly worse take, it is an
 * unusable one.
 *
 * TARGET: stated as a RANGE, and the instruction is in cycles rather than
 * seconds. Measured on the training corpus, the median cycle is ~2.6s, so eight
 * cycles is about twenty seconds and three cycles is about eight.
 *
 * Why a range and not a single number: in that corpus every COPD recording was
 * exactly 20.00s with zero variance, while healthy and pneumonia ran from 8s to
 * 86s. A fixed 20s target happens to sit at the COPD mode, and Stage 1
 * aggregates per-cycle features with mean/max/std over however many cycles a
 * file contains -- so cycle count, and therefore duration, leaks into the
 * feature vector. Asking for breaths rather than a stopwatch keeps the capture
 * clinically honest and less sensitive to a confound in the training data.
 *
 * CEILING: a long take is not wrong, it just costs upload time for nothing. */
export const MIN_TAKE_SEC = 8
export const TARGET_TAKE_SEC_LOW = 15
export const TARGET_TAKE_SEC_HIGH = 25
export const MAX_TAKE_SEC = 45

/** Median cycle length measured on the training corpus, seconds. */
const MEDIAN_CYCLE_SEC = 2.6

export const TARGET_CYCLES_LOW = 5
export const TARGET_CYCLES_HIGH = 8

/** Per-take guidance. Anything other than "good" is a warning, never a block. */
export type TakeQuality = "too-short" | "good" | "long"

export function takeQuality(seconds: number): TakeQuality {
  if (seconds < MIN_TAKE_SEC) return "too-short"
  if (seconds > MAX_TAKE_SEC) return "long"
  return "good"
}

/** Rough cycle count for a take of the given length. */
export function estimateCycles(seconds: number): number {
  return Math.max(0, Math.floor(seconds / MEDIAN_CYCLE_SEC))
}

/** Live guidance while recording, before the take is committed. */
export function durationAdvice(seconds: number): string {
  if (seconds < MIN_TAKE_SEC) {
    const left = Math.ceil(MIN_TAKE_SEC - seconds)
    return `Keep going — ${left}s more. Too few breaths to analyse.`
  }
  if (seconds < TARGET_TAKE_SEC_LOW) {
    return `${Math.ceil(TARGET_TAKE_SEC_LOW - seconds)}s more for 5–8 breaths.`
  }
  if (seconds <= TARGET_TAKE_SEC_HIGH) {
    return `Good — about ${estimateCycles(seconds)} breaths. Stop when you're ready.`
  }
  if (seconds < MAX_TAKE_SEC) {
    return `Plenty. You can stop here.`
  }
  return `${Math.round(seconds)}s — longer than needed. Stopping now saves upload time.`
}
