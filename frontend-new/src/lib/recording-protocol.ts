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
    how: "Above the right nipple, roughly level with the breastbone.",
  },
  {
    code: "Al",
    name: "Anterior left",
    where: "3rd left intercostal space, mid-clavicular line",
    how: "Above the left nipple, roughly level with the breastbone.",
  },
  {
    code: "Pr",
    name: "Posterior right",
    where: "Between the right scapula and the spine",
    how: "Have the patient sit up and lean forward. Listen between the shoulder "
       + "blade and the spine, on the right.",
  },
  {
    code: "Pl",
    name: "Posterior left",
    where: "Between the left scapula and the spine",
    how: "Same position, mirror side. Most of the lower lobes are heard from "
       + "behind.",
  },
  {
    code: "Tr",
    name: "Trachea (midline)",
    where: "Centre of the neck, just below the Adam's apple",
    how: "Breath sounds here are central and louder. This reading breaks up a "
       + "set that otherwise came from one side.",
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
 * Floor: too few breathing cycles for the features to be meaningful.
 * Target: comfortably inside the training range, and short enough that a
 * clinician will actually hold for it.
 * Ceiling: a long take is not wrong, but it costs upload time for nothing. */
export const MIN_TAKE_SEC = 10
export const TARGET_TAKE_SEC = 20
export const MAX_TAKE_SEC = 45

/** Per-take guidance. Anything other than "good" is a warning, never a block. */
export type TakeQuality = "too-short" | "good" | "long"

export function takeQuality(seconds: number): TakeQuality {
  if (seconds < MIN_TAKE_SEC) return "too-short"
  if (seconds > MAX_TAKE_SEC) return "long"
  return "good"
}

/** Live guidance while recording, before the take is committed. */
export function durationAdvice(seconds: number): string {
  if (seconds < MIN_TAKE_SEC) {
    const left = Math.ceil(MIN_TAKE_SEC - seconds)
    return `Keep going — ${left}s more. A take shorter than ${MIN_TAKE_SEC}s `
      + `has too few breathing cycles to analyse.`
  }
  if (seconds < TARGET_TAKE_SEC) {
    return `${Math.ceil(TARGET_TAKE_SEC - seconds)}s to go for a full take. `
      + `This one will work.`
  }
  if (seconds < MAX_TAKE_SEC) {
    return `Plenty. Stop whenever you are ready.`
  }
  return `${Math.round(seconds)}s — longer than needed. Stopping now saves upload time.`
}
