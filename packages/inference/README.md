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
| Objective | `binary:logistic` (400 trees) |
| Input | 153-d aggregated acoustic feature vector |
| Output | `p_healthy` |
| Threshold | `0.61` |

At or above the threshold the recording is **Healthy**: it is pinned to
`(p_healthy = 1.0, p_pneumonia = 0.0, p_copd = 0.0)` and never reaches Stage 2.
Below it, the recording is routed to Stage 2.

### Stage 2 — "2.5" EfficientNetB0

| | |
|---|---|
| Model | `model_2_5_export/stage2_model_2_5_efficientnet.keras` |
| Head | Dense(256) → Dense(128) → **Dense(1, sigmoid)** |
| Input | `(None, 64, 128, 3)` log-mel tensor |
| Output | `p_copd` — **binary COPD vs Pneumonia** |
| Threshold | `0.47` |

The head is a single sigmoid unit, so the output is the COPD probability and
`p_pneumonia = 1 - p_copd`. The EfficientNetB0 backbone resizes to 224×224
internally; the service must **not** resize the tensor.

### Shared preprocessing

- `librosa.load(sr=16000, mono=True)`
- 4th-order Butterworth bandpass, 100–2000 Hz, forward+backward (`filtfilt`) so
  there is no phase distortion
- peak-amplitude normalisation before feature extraction

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