/**
 * Recording protocol.
 *
 * Two decisions live here and both are load-bearing for accuracy rather than
 * presentation:
 *
 * WHICH SITES
 * The training corpus recorded at named anatomical locations -- anterior left,
 * anterior right, posterior left, posterior right, trachea -- using the
 * Al / Ar / Pl / Pr / Tr codes that appear in the dataset filenames. The fusion
 * rule that lets one alarming take override four reassuring ones exists because
 * lung pathology is audible at one site and inaudible at another. That safety
 * net is worthless if all five takes come from the same spot, because then the
 * "five takes" are five copies of one recording and the average is theatre.
 *
 * So the sequence covers both axes: two anterior, two posterior, one midline.
 * The user's instinct -- two left, two right, one middle -- was right about the
 * shape and wrong about the axes; "left and right" alone discards anterior
 * versus posterior, which carry different pathology.
 *
 * Trachea goes LAST rather than third. The override already handles a single
 * site disagreeing with the rest, so a midline reading needs the least weight in
 * the mean while still capturing the central airway. Third place would let it
 * outvote two good peripheral readings.
 *
 * Trachea is also the only real midline site in the data. "Middle of the chest"
 * is not a defined recording location in either dataset.
 *
 * HOW LONG
 * Training recordings ran 10 to 90 seconds. Below that the log-mel window
 * covers too few breathing cycles for the feature set to mean anything, so a
 * very short take is not a slightly worse take -- it is an unusable one.
 *
 * SUGGESTED, NEVER REQUIRED
 * A clinician under a queue who is blocked from recording has no way to complete
 * a screening at all. So the site is shown, the previous take's site is shown
 * beside it, and nothing stops them recording wherever is clinically right. The
 * guidance works by being visible, not by being enforced.
 */

/** Anterior/posterior + left/right, plus the trachea as the midline site. */
export const AUSCULTATION_SITES = [
  {
    code: "Ar",
    name: "Anterior right",
    where: "3rd right intercostal space, mid-clavicular line",
    how: "Patient sitting upright, facing you. Place the diaphragm flat against "
       + "the chest, just below the collarbone on the RIGHT, roughly level with "
       + "the breastbone and a little to the side of the nipple. Slide it "
       + "sideways rather than angling it.",
  },
  {
    code: "Al",
    name: "Anterior left",
    where: "3rd left intercostal space, mid-clavicular line",
    how: "The mirror of the right side. Same height, just below the LEFT "
       + "collarbone and level with the nipple. Keep the diaphragm flat and "
       + "sealed against the skin.",
  },
  {
    code: "Pr",
    name: "Posterior right",
    where: "Between the right scapula and the spine",
    how: "Patient leans forward, arms crossed in front. Reach round from "
       + "behind and place the diaphragm between the RIGHT shoulder blade and "
       + "the spine, about level with the middle of the blade. Skin contact "
       + "matters more than the exact centimetre here.",
  },
  {
    code: "Pl",
    name: "Posterior left",
    where: "Between the left scapula and the spine",
    how: "Same position, mirrored: between the LEFT shoulder blade and the "
       + "spine with the patient leaning forward. Most of the lower lobes are "
       + "heard from behind, so these two carries a lot of the result.",
  },
  {
    code: "Tr",
    name: "Trachea (midline)",
    where: "Centre of the neck, just below the Adam's apple",
    how: "Hold the bell or diaphragm flat against the front of the neck, "
       + "centred, a finger's width under the Adam's apple. Use the bell if the "
       + "stethoscope has one -- breath sounds here are central and louder, and "
       + "this reading breaks up a set that otherwise came from one side. Last, "
       + "because it is the midline and not a left/right comparison.",
  },
] as const

export type Site = (typeof AUSCULTATION_SITES)[number]
export type SiteCode = Site["code"]

/** Which site to suggest for the next take. */
export function suggestedSite(takenCount: number): Site {
  return AUSCULTATION_SITES[Math.min(takenCount, AUSCULTATION_SITES.length - 1)]
}

export function siteByCode(code: string): Site | undefined {
  return AUSCULTATION_SITES.find((s) => s.code === code)
}

/* --- Duration ------------------------------------------------------------
 * FLOOR: below this there are too few breathing cycles for the feature set to
 * mean anything. A very short take is not a slightly worse take, it is an
 * unusable one.
 *
 * TARGET: stated as a RANGE, and the instruction is in cycles rather than
 * seconds. Measured on the training corpus, the median cycle is ~2.6s, so four
 * cycles is about ten seconds and eight is about twenty.
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
export const MIN_TAKE_SEC = 10
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
