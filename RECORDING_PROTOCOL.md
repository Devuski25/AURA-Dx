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

**Count breaths, not seconds.** The instruction is **5–8 full breaths**, roughly
15–25s. The clock is there to catch a take that is far too short or far too long,
not to hit a number.

| | Value | Why |
|---|---|---|
| **Floor** | 10s | Too few breaths for the feature set to mean anything. A very short take is not a slightly worse take — it is an unusable one |
| **Target** | 5–8 breaths (≈15–25s) | Median cycle on the training corpus is ~2.6s, so five cycles ≈ 10s and eight ≈ 20s |
| **Ceiling** | 45s | Longer isn't wrong, it just costs upload time for nothing |

### Why breaths rather than a stopwatch

Measured on the training corpus:

```
copd       mean 20.00s   std 0.00   min 20.00   max 20.00
healthy    mean 26.54s   std 16.88
pneumonia  mean 22.89s   std 10.33
```

**Every COPD recording was exactly 20.00 seconds, with zero variance.** Healthy
and pneumonia ranged from 8s to 86s.

Stage 1 aggregates per-cycle features with `mean / max / std` over however many
cycles a file contains, and cycle count scales with duration — 20s yields ~8
cycles, 86s yields ~34. So duration leaks into the feature vector, and a fixed
20-second target happens to sit exactly on the COPD mode.

Asking for breaths rather than a stopwatch keeps the capture clinically honest
and less sensitive to a confound that lives in the training data rather than in
the patient. See "Known confounds" below.

The screen shows a live clock with a rolling breath count. A take under the floor
is **kept but flagged** — discarding a clinician's recording without asking is
worse than telling them it was short and letting them decide.

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

## Known confounds in the training data

Found by auditing the corpus these models were fitted on. **Neither is a bug in
the app, and neither is fixed here** — they are properties of the training data
and a research decision, not a code one.

### 1 · Sample rate is confounded with class

```
sample rate      4000   10000   44100
copd                 0       0    1565    ← 100% full-band
healthy            815      61    1985
pneumonia          201       0    2000
```

The pipeline bandpasses **100–2000 Hz**. A 4 kHz file has Nyquist at exactly
2000, so the top of that band is not present in it at all.

**1016 of 6627 files (15.3%) are bandwidth-limited, and none of them are COPD.**
The model can therefore separate COPD from a slice of the other two classes by
spectral extent alone, with no reference to pathology.

At deployment this may not hurt — a digital stethoscope records at a high rate
and so matches the COPD profile — but the **reported accuracy is inflated**, and
it may bias *toward* COPD.

### 2 · Zero duration variance in COPD

Covered above under "How long". The same leak, one axis further out.

### 3 · Twenty-three subjects span two classes

```
copd 33 · healthy 94 · pneumonia 24 subjects
subjects appearing under >1 class: 23
```

A patient cannot be COPD and healthy simultaneously. Either the label was
derived per-file rather than per-patient, or those subjects carry combined
diagnoses. This needs an explanation in the write-up.

`StratifiedGroupKFold(groups=subject_id)` keeps every file from a subject in one
fold, so there is no leakage *across* the split regardless.

### What is clean

- **No label contamination** — 0 rows fell outside `LABEL_MAP`
- **Silent zero padding** — 1 cycle of 6627
- **Subject isolation** — grouping is correct
- **Duration target** — 20s is the median for all three classes

### Options, if these need addressing

| Option | Removes | Cost |
|---|---|---|
| Report as stated limitations | nothing | None. Accuracy stays inflated |
| Retrain on fixed 20s crops of every file | both shortcuts | Full retrain |
| Re-band-limit everything to 100–1800 Hz | #1 only | Retrain |

Worth raising with an adviser before touching a trained model.

---

## Verification

```bash
cd frontend-new && npx tsc -b --noEmit   # types
cd frontend-new && npm run build
python scripts/check-responsive.py
```

Not verified: rendered appearance, and a real capture through a real stethoscope.
Both need a browser and the hardware.
