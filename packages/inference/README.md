# Inference Package — Multi-Recording Respiratory Screening

FastAPI service that scores a batch of **3–5 stethoscope recordings** and returns a
single fused verdict across three classes: **Healthy / COPD / Pneumonia**.

## Directory Structure

```
packages/inference/
├── inference_service.py   # The service (FastAPI app)
└── requirements.txt
model_1_5_export/          # (repo root) Stage 1
└── model_1_5_xgboost.json
model_2_5_export/          # (repo root) Stage 2
├── stage2_model_2_5_efficientnet.keras
└── model_2_5_results.md
```

Model files are loaded from the repo root, resolved relative to this file. They are
**not** vendored into the package directory.

## Quick Start

```bash
cd packages/inference
pip install -r requirements.txt
uvicorn inference_service:app --reload --port 8000
curl http://localhost:8000/health
```

## Pipeline

Each recording is scored independently, then fused.

### Stage 1 — "1.5" XGBoost screening

| | |
|---|---|
| Model | `model_1_5_export/model_1_5_xgboost.json` |
| Objective | `binary:logistic` (400 trees, `scale_pos_weight` 1.54) |
| Input | 153-d cycle-aggregated acoustic feature vector |
| Output | `p_healthy` |
| Threshold | `0.61` |

At or above the threshold the recording is **Healthy**: it is pinned to
`(p_healthy = 1.0, p_pneumonia = 0.0, p_copd = 0.0)` and never reaches Stage 2.
Below it, the recording is routed to Stage 2.

**Feature layout — order is load-bearing.** 51 descriptors per cycle × 3
statistics, concatenated as `hstack([mean, max, std])`:

| Indices | Contents |
|---|---|
| 0–12 | MFCC, `n_mfcc=13`, `fmin=100`, `fmax=2000`, mean over time |
| 13–25 | delta-MFCC mean |
| 26–38 | delta-delta-MFCC mean |
| 39 | spectral centroid mean |
| 40 | spectral bandwidth mean |
| 41–47 | spectral contrast mean (`fmin=100`, 7 bands) |
| 48 | spectral flatness mean |
| 49 | zero-crossing rate mean |
| 50 | RMS mean |
| **51–101** | the same 51, **max** over cycles |
| **102–152** | the same 51, **std** over cycles |

XGBoost indexes features positionally, so swapping the `max` and `std` blocks
would feed every tree scrambled values and still return confident nonsense.

The recording is bandpassed **once as a whole**, then cut into 2.5 s cycles at a
1.25 s hop. Peak normalisation is per-cycle, after the bandpass.

### Stage 2 — "2.5" EfficientNetB0

| | |
|---|---|
| Model | `model_2_5_export/stage2_model_2_5_efficientnet.keras` |
| Head | Dense(256) → Dropout → Dense(128) → Dropout → **Dense(1, sigmoid)** |
| Input | `(None, 64, 128, 3)` log-mel tensor |
| Output | **`p_pneumonia`** — binary Pneumonia vs COPD |
| Threshold | `0.47` |

The head was trained with `y_stage2 = 1` for Pneumonia and `0` for COPD, so the
sigmoid output **is** the pneumonia probability; `p_copd = 1 - p_pneumonia`.
(`model_2_5_results.md` labels the 0.47 threshold "(COPD)" — that heading is
wrong. Notebook cell 12, the only place the threshold is actually applied,
reads `p_pneumonia >= 0.47 -> Pneumonia`.)

Preprocessing, per 2.048 s window:

```
melspectrogram(n_fft=1024, hop_length=256, n_mels=64, fmin=50, fmax=2000)
power_to_db(ref=np.max)                     -> [-80 dB, 0 dB]
pad/truncate to exactly 128 frames, padding with -80 dB
(log_mel + 80) / 80, clipped to [0, 1]
repeat to 3 channels
```

Two steps here are easy to omit and both silently degrade accuracy:

- **The `/80` rescale.** Raw dB runs −80..0, a very different input range from
  the `[0, 1]` the backbone was fitted on.
- **The pad value.** Short windows pad with −80 dB, which maps to exactly `0.0`
  after the rescale — silence, not an edge-repeat of the last frame.

The `Resizing(224, 224)` layer lives *inside* the model, so the service must
return the raw 64×128×3 tensor and must not resize it.

Each training example was one annotated respiratory cycle = 128 mel frames =
2.048 s. A 10 s take is therefore cut into overlapping 2.048 s windows at 50%
overlap, and the per-window probability is **max-pooled** — pneumonia may be
audible in only one part of a take, and averaging would let quiet stretches
dilute it. The window count is capped at 24 so a pathological upload cannot pin
the worker.

### Shared preprocessing

- `librosa.load(sr=16000, mono=True)`
- 4th-order Butterworth bandpass, 100–2000 Hz, forward+backward (`filtfilt`) so
  there is no phase distortion
- peak-amplitude normalisation before feature extraction

Note the two stages use **different** FFT settings. Stage 1 uses librosa's
default `n_fft=2048` / `hop_length=512` for every descriptor; Stage 2 uses
`n_fft=1024` / `hop_length=256`. The notebook does this deliberately. Do not
unify them.

---

## ⚠️ Known train/serve skew in the notebook

Notebook **cell 5** (which built the training tensors) and **cell 12** (which
evaluated them) do **not** extract the same tensor:

| | cell 5 (training) | cell 12 (evaluation) |
|---|---|---|
| `n_fft` / `hop` | 1024 / 256 | default 2048 / 512 |
| `fmin` | 50 Hz | 100 Hz |
| range rescale | `(dB + 80) / 80`, clipped | none |
| padding | `constant_values=-80.0` | `constant_values=0` |

This service implements **cell 5**, because that is what the weights were fitted
on. Feeding a cell-12 tensor to the model is serving it a distribution it has
never seen — it will not crash, it will just be wrong. The reported 69.92%
balanced accuracy was measured through the cell-12 path and therefore does not
describe what this service does.

## Fusion — mean, then safety override

```
mean_p = mean(p_pneumonia across recordings)
```

The mean decides the verdict, **except** when one recording reaches
`STAGE2_OVERRIDE_THRESHOLD` (default `0.60`) confidence for pneumonia. That
recording wins regardless of the mean.

Lung pathology audible at one auscultation site can be inaudible at another, so
averaging must not be allowed to bury a high-confidence finding. This
deliberately trades specificity for sensitivity — a missed pneumonia is far
worse than a false alarm.

## ⚠️ Verify before trusting results

The Stage 1 153-feature layout is the one part of this pipeline that **cannot be
verified from the model file alone**. `build_stage1_features()` in
`inference_service.py` uses:

- 51 base descriptors (13 MFCC + 13 delta + 13 delta-delta + 12 spectral)
- × 3 cycle statistics (mean, std, max) = 153

The per-descriptor ordering must match the training feature builder exactly.
Check it against the training notebook before results are clinically meaningful.
A wrong ordering does not crash — it silently returns meaningless probabilities.

## API

### `POST /api/inference`

Multipart form. Send 3–5 `.wav` files under the repeated field name `audios`.

```bash
curl -X POST http://localhost:8000/api/inference \
  -H "X-API-Key: $INFERENCE_API_KEY" \
  -F "audios=@take1.wav" \
  -F "audios=@take2.wav" \
  -F "audios=@take3.wav"
```

Response:

```json
{
  "model_version": "2.5.0-multi",
  "recordings_received": 3,
  "per_clip": [ { "index": 0, "clip_label": "Pneumonia", "pneumonia_prob": 0.71, "...": "..." } ],
  "respiratory_result": {
    "label": "Pneumonia",
    "confidence": 0.71,
    "probabilities": { "Healthy": 0.12, "Pneumonia": 0.71, "COPD": 0.17 }
  },
  "fusion": {
    "method": "mean_then_safety_override",
    "recordings_fused": 3,
    "override_applied": "single_clip_high_confidence_pneumonia",
    "override_triggered_by_clip": 0,
    "override_threshold": 0.6,
    "stage1_healthy_threshold": 0.61,
    "stage2_copd_threshold": 0.47
  },
  "clinical_note": "Screening support only, not a diagnosis..."
}
```

The API key is only enforced when `INFERENCE_API_KEY` is set in the environment.

### `GET /health`

Reports whether both models loaded.