# Recording Protocol

How to capture breathing sounds so the screening works. Everything on the
recording screen comes from `frontend-new/src/lib/recording-protocol.ts` — there
is no second copy of these numbers in the UI, which is the only way a protocol
like this stays consistent with itself.

---

## Why sites matter more than anything else on that screen

The fusion rule that lets **one alarming take override four reassuring ones**
exists for one reason:

> Lung pathology audible at one auscultation site is routinely inaudible at
> another.

That safety net is only worth anything if the takes come from different places.
**Five recordings from one spot carry exactly as much information as one** — the
app would average five copies of the same audio and report a confident verdict
built from a single sample. The confidence level would be a lie.

This is the highest-leverage thing on the screen, and it costs nothing but
moving the stethoscope.

---

## 1 · Where to listen

The training corpus recorded at named anatomical locations, using the codes that
appear in the dataset filenames: `Al` `Ar` `Pl` `Pr` `Tr`.

| # | Site | Code | Where | How |
|---|---|---|---|---|
| 1 | **Anterior right** | `Ar` | 3rd right intercostal space, mid-clavicular line | Above the right nipple, roughly level with the breastbone |
| 2 | **Anterior left** | `Al` | 3rd left intercostal space, mid-clavicular line | Above the left nipple, mirror side |
| 3 | **Posterior right** | `Pr` | Between the right scapula and the spine | Patient sits up and leans forward |
| 4 | **Posterior left** | `Pl` | Between the left scapula and the spine | Same position, mirror side. Most of the lower lobes are heard from behind |
| 5 | **Trachea** | `Tr` | Centre of the neck, just below the Adam's apple | Central and louder; breaks up a set that came from one side |

### Why this order

**Both axes, not just left/right.** The original idea was "two left, two right,
one middle". Right about the shape, wrong about the axes — anterior and
posterior carry different pathology, and `Pl` is not interchangeable with `Al`.

**Trachea last, not middle.** The override already handles one site disagreeing
with the rest, so the midline reading needs the *least* weight in the mean while
still capturing the central airway. Third place would let it outvote two good
peripheral readings.

**Trachea rather than "middle of the chest".** Trachea is a real, defined
recording location in the dataset. "Middle of the chest" is not.

### Suggested, never required

A clinician behind a queue who is *blocked* from recording cannot complete a
screening at all. So nothing here is enforced. The site is offered, the previous
take's site is shown beside it so repeating one is visible, and they record
wherever is clinically right.

---

## 2 · How long

| | Seconds | Why |
|---|---|---|
| **Minimum** | 10s | Below this there are too few breathing cycles for the feature set to mean anything. A very short take is not a slightly worse take — it is an unusable one |
| **Target** | **20s** | Roughly 3–4 full breaths. Comfortably inside the training range |
| **Ceiling** | 45s | Longer isn't wrong, it just costs upload time for nothing |

Training recordings ran **10–90 seconds**, so the app's window sits inside it.

The screen shows a live clock and counts down to the target. A take under the
minimum is **kept but flagged** — discarding a clinician's recording without
asking is worse than telling them it was short and letting them decide.

---

## 3 · Technique

- Patient upright, breathing quietly through the mouth
- **Seal the chestpiece.** Air leaking in is the most common cause of a poor take
- Quiet room — fan, air-conditioning and conversation all land in the recording
- Hold still; rustling fabric and moving the tube read as adventitious sounds
- Watch the level meter: **flat means nothing is arriving**, **into the red means clipping**

---

## What the screen now shows

| Element | Why |
|---|---|
| **Device banner** | Names the connected input, or warns that no stethoscope was found. Previously nothing distinguished the stethoscope from the built-in microphone — and the two are indistinguishable until the takes come back useless |
| **Device picker** | When more than one input exists, choose explicitly |
| **Level meter** | Real `AnalyserNode` peak from the capture stream |
| **Site prompt** | Suggests the next site, shows the last one, warns when it repeats |
| **Site chip** | On each recorded take, so the set is auditable at a glance |
| **Duration flag** | Under 10s marks the take in the list |
| **Clip warning** | A clipped take is flagged on stop; a distorted waveform still gets scored as though it were clean |

### The fake equalizer is gone

It animated on a timer, identically, whether or not audio was arriving. A muted
or unplugged stethoscope looked exactly like a working one — which on a capture
screen is the most misleading thing that can happen, because the clinician has
no way to tell they are recording silence until they delete the take.

---

## Recording settings

`echoCancellation`, `noiseSuppression` and `autoGainControl` are all **off**.

A digital stethoscope is a clinical instrument; the browser's voice-call
processing is tuned for speech and will apply gain shaping and spectral
subtraction to a signal that must stay faithful. Sample rate and channel count
are not requested either — the capture is resampled to 16 kHz mono downstream,
and pinning values in the browser only risks it refusing a device that would
otherwise work.

---

## Verification

```bash
cd frontend-new && npx tsc -b --noEmit   # types
cd frontend-new && npm run build
python scripts/check-responsive.py
```

Not verified: rendered appearance, and a real capture through a real stethoscope.
Both need a browser and the hardware.
