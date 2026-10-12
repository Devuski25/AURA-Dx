# MODEL_CARD — AURA-Dx v2.5

Source of truth for the two models behind every screening result. Anything that
contradicts this file is a bug.

---

## Pipeline

```
3–5 stethoscope takes (16 kHz WAV)
        │
        ├─ per take ─→ Stage 1 "1.5" XGBoost        → p_healthy   (threshold 0.61)
        │                   │
        │                   ├─ healthy  → take is done, Stage 2 never runs
        │                   └─ abnormal ↓
        │             Stage 2 "2.5" EfficientNetB0   → p_pneumonia (threshold 0.47)
        │                   → COPD when p_pneumonia < 0.47
        │
        └─ fuse across takes: mean, then single-take safety override at 0.60

Output: Healthy | COPD | Pneumonia
```

TB was a fourth class through v1.0 and is retired as of v2.5. The 1.5/2.5
pipeline never produced it.

---

## Model 1.5 — Stage 1, the healthy screen

| | |
|---|---|
| File | `model_1_5_export/model_1_5_xgboost.json` |
| Objective | `binary:logistic`, 400 trees, `max_depth=4` |
| Target | `1` = Healthy, `0` = Pathological (COPD or Pneumonia) |
| Class weighting | `scale_pos_weight = 1.54` |
| Input | 153-d cycle-aggregated feature vector |
| Output | `p_healthy` |
| Threshold | **0.61** |

Measured: accuracy 76.87%, balanced accuracy 74.67%, macro F1 0.768.
Pathological recall 0.852, Healthy recall 0.642.

### Feature layout — order is load-bearing

51 descriptors per cycle × 3 statistics, concatenated as
`hstack([mean, max, std])`:

| Indices | Contents |
|---|---|
| 0–12 | MFCC mean over time (`n_mfcc=13`, `fmin=100`, `fmax=2000`) |
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

XGBoost indexes features positionally. Swapping the `max` and `std` blocks feeds
every tree scrambled values and still returns confident nonsense — no error is
raised. `packages/inference/test_feature_layout.py` guards this.

### Stage 1 preprocessing

1. `librosa.load(sr=16000, mono=True)`
2. 4th-order Butterworth bandpass **100–2000 Hz**, `filtfilt` (zero phase shift),
   applied **once to the whole recording**
3. Slice into 2.5 s cycles at a 1.25 s hop
4. Per cycle: peak-amplitude normalise, then extract the 51 descriptors
5. Discard cycles shorter than 0.2 s

All descriptors use librosa's **default** `n_fft=2048` / `hop_length=512`. The
notebook never overrides them. Delta width is 9 for segments of ≥9 frames,
narrowed for shorter ones, and zeroed entirely below width 3.

---

## Model 2.5 — Stage 2, COPD against pneumonia

| | |
|---|---|
| File | `model_2_5_export/stage2_model_2_5_efficientnet.keras` |
| Backbone | EfficientNetB0, frozen, ImageNet weights |
| Head | Dense(256) → Dropout(0.5) → Dense(128) → Dropout(0.3) → Dense(1, sigmoid) |
| Input | `(None, 64, 128, 3)` log-mel |
| Target | `1` = Pneumonia, `0` = COPD |
| Output | **`p_pneumonia`** — `p_copd = 1 - p_pneumonia` |
| Threshold | **0.47** |

Measured standalone: accuracy 72.48%, balanced accuracy 69.92%, macro F1 0.699.
Pneumonia recall 0.785, COPD recall 0.613.

The head was trained with `y_stage2 = 1` for Pneumonia, so the sigmoid output
**is** the pneumonia probability. `model_2_5_results.md` heads the 0.47
threshold "(COPD)" — that heading is wrong; the training notebook's end-to-end
cell applies it as `p_pneumonia >= 0.47 → Pneumonia`, which is the only place
the threshold is actually used.

### Stage 2 preprocessing

```
melspectrogram(n_fft=1024, hop_length=256, n_mels=64, fmin=50, fmax=2000)
power_to_db(ref=np.max)                      -> [-80 dB, 0 dB]
pad/truncate to exactly 128 frames, padding with -80 dB
(log_mel + 80) / 80, clipped to [0, 1]
repeat to 3 channels
```

Two steps are easy to omit and both degrade accuracy without erroring:

- **The `/80` rescale.** Raw dB runs −80..0, a different input range from the
  `[0, 1]` the backbone was fitted on.
- **The pad value.** Short windows pad with −80 dB, which maps to exactly `0.0`
  after the rescale — silence, not an edge-repeat of the last frame.

`Resizing(224, 224, bilinear)` lives *inside* the model. The service returns the
raw 64×128×3 tensor and must not resize it.

### Windowing

One training example is one annotated respiratory cycle = 128 mel frames at hop
256 = **2.048 s**. A longer take is cut into overlapping 2.048 s windows at 50%
overlap — the same stride ratio the notebook used for training (375/188).

Per-window probabilities are **max-pooled**, not averaged: pneumonia may be
audible in one part of a take, and averaging would let the quiet stretches
dilute it. Window count is capped at 24 so a pathological upload cannot pin the
worker.

---

## Fusion across takes

1. **Safety override, checked first.** Any single take at `p_pneumonia ≥ 0.60`
   wins outright. This runs *before* the Healthy branch, otherwise four
   healthy-looking takes would bury the one site where pathology is audible.
2. **Otherwise the mean decides.** Healthy if mean `p_healthy ≥ 0.61`.
3. **Otherwise the louder pathological class wins**, preferring Pneumonia as the
   acute class.

This deliberately trades specificity for sensitivity. A missed pneumonia is far
worse than a false alarm.

Covered by `packages/inference/test_fusion.py`.

---

## ⚠️ Known train/serve skew in the training notebook

The training cell and the end-to-end evaluation cell of
`final icbhi nb.ipynb` do **not** extract the same tensor:

| | training cell | evaluation cell |
|---|---|---|
| `n_fft` / `hop` | 1024 / 256 | default 2048 / 512 |
| `fmin` | 50 Hz | 100 Hz |
| range rescale | `(dB + 80) / 80` clipped | none |
| padding | `constant_values=-80.0` | `constant_values=0` |

**This service implements the training cell**, because that is what the weights
were fitted on.

The consequence is visible in the notebook's own output. Run end-to-end through
the evaluation path, the cascade scores:

```
Overall Accuracy : 0.3270
    Pneumonia     precision 1.000   recall 0.009
```

Stage 1 alone scores 71.86%, Stage 2 alone 72.48%. Combined they score 32.7%,
and almost everything falls through to COPD, because Stage 2 receives an
out-of-distribution tensor, outputs ≈0, and nothing crosses 0.47.

The balanced-accuracy figures quoted in `model_1_5_results.md` and
`model_2_5_results.md` were each measured on their own stage in isolation.
Neither describes the cascade as a whole. **Do not quote them as end-to-end
performance.**

---

## Limits

- Trained on ICBHI respiratory recordings, not on stethoscope audio. The domain
  gap is real and unmeasured.
- Balanced accuracy under 75% on both stages. Not a diagnostic device.
- Three classes only. Asthma, bronchiectasis, pulmonary fibrosis and TB are not
  detected — a healthy result does not exclude them.
- Fusion weights are unweighted means. No take is weighted above another.

---

## Reproducibility

Training reference: `final icbhi nb.ipynb`. Every preprocessing constant in
`packages/inference/inference_service.py` is lifted from it verbatim.

```bash
python packages/inference/test_fusion.py          # fusion + constants, numpy only
python packages/inference/test_feature_layout.py  # 153-d layout, numpy only
python packages/inference/test_preprocessing.py   # needs a working librosa
```