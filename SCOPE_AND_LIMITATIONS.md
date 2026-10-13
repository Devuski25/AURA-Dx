# SCOPE AND LIMITATIONS — AURA-Dx v2.5

What this system does, what it does not do, and where it should not be relied on.

---

## What it is

An AI-assisted **screening** tool. A clinician records three to five
stethoscope takes, and the system returns a probability distribution over three
classes plus a suggested next step. A qualified clinician makes the diagnosis.
The system does not.

Classes screened: **Healthy, COPD, Pneumonia**.

TB was screened through v1.0 and is retired. The current models never produce
it, the schema no longer stores it, and the UI no longer displays it.

---

## Accuracy

| Stage | Task | Balanced accuracy |
|---|---|---|
| 1.5 (XGBoost) | Healthy vs pathological | 74.67% |
| 2.5 (EfficientNetB0) | Pneumonia vs COPD | 69.92% |

Both measured on a patient-isolated test split, each stage on its own.

**These do not compose into an end-to-end figure.** See the train/serve skew
section of `MODEL_CARD.md` — the notebook's own end-to-end run scores 32.7% with
0.9% pneumonia recall, because its evaluation path feeds Stage 2 a differently
preprocessed tensor than it was trained on. The service implements the correct
path, but **no end-to-end accuracy measurement exists yet for the deployed
configuration.** That should be measured before any accuracy claim is made.

---

## Limitations

### Domain gap
Trained on ICBHI respiratory recordings — ambient and lab-captured. Deployed on
stethoscope audio through a phone or tablet microphone. The gap is real,
unmeasured, and is the single largest risk to accuracy in this system.

### Low-confidence results are not surfaced as such
Every screening returns a probability. A near-even distribution is reported the
same way as a confident one. There is no "inconclusive" band, and no automatic
re-test prompt.

### No longitudinal comparison
Screenings are independent. Nothing compares a new result against a patient's
previous ones, and nothing detects deterioration over time.

### Threshold sensitivity
The 0.61 and 0.47 thresholds were chosen on one test split. Small shifts move
false negatives and false positives in opposite directions. The 0.60 safety
override was chosen as a safety-first default and has not been tuned against
clinical outcomes, because there are none yet.

### Unweighted fusion
Take probabilities are averaged with equal weight. A take recorded with a worse
stethoscope placement counts the same as a clean one. There is no quality gate
rejecting a silent or saturated take.

### Clinical scope
Three classes only. Not detected: asthma, bronchiectasis, pulmonary fibrosis,
pulmonary embolism, heart failure, upper-airway disease, TB. A Healthy result
excludes none of these.

---

## Hardware

| | |
|---|---|
| Inference | CPU only, no GPU |
| Stage 1 | XGBoost, 400 trees, negligible |
| Stage 2 | EfficientNetB0, ~24 passes worst case per screening |
| Both models loaded in memory at startup | ~25 MB combined |

Runs on the Mini PC. Model loading is the slow part of startup, which is why
`deploy/mini-pc/start-aura-services.ps1 start` health-checks before reporting success.

---

## Preprocessing coupling

Stage 1 and Stage 2 use **different** FFT settings and different frequency
bands. This is not an oversight — it is what the training notebook does.

Stage 1: default `n_fft=2048` / `hop=512`, MFCC `fmin=100` / `fmax=2000`,
2.5 s cycles, aggregated to a 153-d vector.
Stage 2: `n_fft=1024` / `hop=256`, mel `fmin=50` / `fmax=2000`, 2.048 s windows.

"Cleaning these up" to use one consistent set of parameters would silently break
both models. See `MODEL_CARD.md`.

---

## Audio handling limits

- `.wav` only on the inference endpoint
- Recordings under 0.2 s of usable audio are rejected as too short
- No noise suppression, echo cancellation, or heartbeat removal
- No check for clipping, silence, or a stethoscope detached from the chest
- Files are stored on the backend host's disk, unencrypted at rest

---

## Deployment

- Frontend auto-deploys to Cloudflare on push to `main`
- Backend and inference run on the Mini PC and are **not** always-on. Use
  `deploy/mini-pc/start-aura-services.ps1 start` / `stop` / `status`.
- Database migrations must be applied before a backend that references new
  columns is started. Starting them out of order produces a 500 on screening
  creation, not a startup failure.