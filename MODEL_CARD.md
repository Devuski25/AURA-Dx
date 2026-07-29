# COUGHPH Model Card

## Overview

Two-stage cascade model for cough sound analysis. Runs ONNX Runtime on CPU.

```
Cough audio → TB Gatekeeper → Non-TB? → Respiratory Classifier
                ↓ TB                          ↓ result
            result (stop)              Healthy / Pneumonia / COPD
```

---

## Model 1: TB Gatekeeper

| Property | Value |
|----------|-------|
| **Architecture** | ResNet-18 (pretrained on ImageNet, transfer learned) |
| **Input shape** | `(batch, 3, 224, 224)` — log-mel spectrogram resized |
| **Output classes** | `Non-TB`, `TB` |
| **Slice duration** | **0.45 seconds** (7200 samples @ 16kHz) |
| **Training dataset** | DATASET_1_TB_GATEKEEPER |
| **Training framework** | PyTorch (torchaudio) → exported to ONNX |

### When it fires
Always runs first. If **TB** is detected (highest confidence), cascade stops and returns only the TB result. If **Non-TB**, it proceeds to Model 2.

---

## Model 2: Respiratory Classifier

| Property | Value |
|----------|-------|
| **Architecture** | ResNet-18 (pretrained on ImageNet, transfer learned) |
| **Input shape** | `(batch, 3, 224, 224)` — log-mel spectrogram resized |
| **Output classes** | `Healthy`, `Pneumonia`, `COPD` |
| **Slice duration** | **2.0 seconds** (32000 samples @ 16kHz) |
| **Training dataset** | DATASET_2_RESPIRATORY |
| **Training framework** | PyTorch (torchaudio) → exported to ONNX |

### When it fires
Only runs if Model 1 says **Non-TB**. The longer 2-second window captures breathing patterns, crackles, and wheezes needed for respiratory distinction.

---

## Preprocessing Pipeline (matches training exactly)

```
Raw audio (any format: wav/mp3/flac/ogg/m4a)
  ↓
librosa.load(sr=16000, mono=True)
  ↓
Peak-centered slice (0.45s or 2.0s)
  ↓
librosa.feature.melspectrogram(n_mels=64, n_fft=1024, hop_length=256)
  ↓
librosa.power_to_db(ref=np.max)
  ↓
Min-max normalization: (x - min) / (max - min + 1e-6)
  ↓
scipy.ndimage.zoom → resize from (64, T) to (224, 224) — bilinear
  ↓
Stack 3× → (3, 224, 224)
  ↓
ONNX Runtime inference
  ↓
Softmax → label + confidence
```

### Key details

- **n_mels=64**: matches training, not 224. The 64 mel bands are resized to 224×224 via bilinear interpolation to match the ONNX input format.
- **n_fft=1024**: wider FFT window gives better frequency resolution at low frequencies where cough information lives.
- **hop_length=256**: 16ms steps between frames at 16kHz.
- **Min-max normalization per sample**: matches training (`torchaudio.AmplitudeToDB` + manual normalization). Not ImageNet normalization — that was incorrect.
- **No low-pass filter**: 3000Hz Butterworth was removed. It was never used during training and was discarding frequencies the model may rely on.
- **No padding/truncation to 224 time steps**: Instead, the mel spectrogram is resized to 224×224 regardless of original time dimension. This preserves the full slice content.

---

## Class Behavior & Clinical Meaning

### TB Gatekeeper

| Prediction | Meaning | Suggested Action |
|------------|---------|------------------|
| **Non-TB** | No TB特征 detected in cough acoustics | Proceed to respiratory classifier, or consider sputum/X-ray if symptoms persist |
| **TB** | Acoustic features consistent with pulmonary TB | Refer for chest X-ray, GeneXpert, or sputum culture |

### Respiratory Classifier

| Prediction | Meaning | Suggested Action |
|------------|---------|------------------|
| **Healthy** | Normal cough acoustics, no pathology detected | No further action unless symptoms persist |
| **Pneumonia** | Acoustic features consistent with pneumonia | Refer for chest X-ray, CBC, CRP; consider antibiotics |
| **COPD** | Acoustic features consistent with COPD | Refer for spirometry; consider bronchodilators |

> **Important**: These are screening suggestions only. All results require clinical verification. The model is a triage tool, not a diagnostic device.

---

## Hardware Requirements

### Minimum (tested on NUC-style PC)

| Component | Requirement |
|-----------|-------------|
| **CPU** | x86-64, 4+ cores @ 1.5GHz+ |
| **RAM** | 4GB minimum, 8GB recommended |
| **Storage** | 500MB (models + service) |
| **OS** | Windows 10+, Ubuntu 20.04+, Raspberry Pi OS |
| **Python** | 3.10+ |

### Inference performance

| CPU | TB inference | Full cascade | Notes |
|-----|------------|--------------|-------|
| Intel N100 (4C/4T @ 3.4GHz) | ~150ms | ~300ms | Good for real-time |
| Raspberry Pi 5 (Cortex-A76) | ~300ms | ~600ms | Usable, add buffer |
| Raspberry Pi 4 (Cortex-A72) | ~600ms | ~1.2s | Slow but functional |
| Old laptop i5-7xxx | ~200ms | ~400ms | Acceptable |

### Network

- **Frontend ↔ Backend**: standard LAN/Wi-Fi (audio upload ~1-5MB per recording)
- **Backend ↔ Inference**: localhost only (FastAPI on port 8000). No network required between them — run on the same machine.

### Deployment architecture options

```
Option A: Single machine (mini PC + USB mic)
  ┌─────────────────────┐
  │  Mini PC / NUC       │
  │  Frontend (React)    │
  │  Backend (FastAPI)   │
  │  Inference (FastAPI) │
  │  ┌─ USB mic ────┐   │
  └─────────────────────┘
  Pros: Simple, no network latency
  Cons: All eggs in one basket

Option B: Mini PC server + separate recording devices
  ┌──────────┐     ┌─────────────────────┐
  │ Recording │     │  Mini PC Server     │
  │ Device    │────▶│  Backend + Inference│
  │ (laptop)  │     └─────────────────────┘
  └──────────┘
  Pros: Recording anywhere on network
  Cons: Upload time depends on network quality
```

---

## Microphone Recommendations

### What matters

The recording hardware affects the **distribution of the audio data**. If the mic introduces artifacts or filtering that wasn't present in the training data, the model may produce unreliable results.

### Do use

| Mic type | Examples | Why |
|----------|----------|-----|
| **Cardioid USB condenser** | Blue Yeti, Rode NT-USB, Fifine K669, Samson Q2U | Rejects room noise from sides/rear via physical design. Does not alter the frequency content. |
| **Dynamic USB** | Shure MV7, Audio-Technica ATR2100x | Less sensitive to ambient noise; good for noisy rooms |
| **Lavalier (lapel) clip-on** | Boya BY-M1, Rode Lavalier II | Consistent distance from mouth, reduces room acoustics |

### Avoid

| Mic type | Why |
|----------|-----|
| **Mics with AI noise cancellation** | The model was trained on unprocessed audio. Noise-cancellation algorithms alter frequency content unpredictably, creating a domain mismatch. |
| **Built-in laptop mics** | Often omnidirectional, pick up fan noise, room reverb, keyboard clicks. Will work but expect lower accuracy. |
| **Bluetooth headsets** | Bluetooth codecs (SBC, AAC) compress audio and can introduce artifacts, especially in the frequency domain. Some use built-in noise suppression that can't be disabled. |

### Key principle

**Clean but unaltered** audio is best. A directional mic that physically rejects room noise is better than a software filter that alters the signal. The model learned from wav files — give it wav-like audio.

### Practical tips for clinic deployment

1. **Consistent mouth-to-mic distance** (15-30cm) — proximity effect changes frequency response
2. **Same room type** for all recordings — similar reverb characteristics
3. **Instruct patient**: one forceful cough, not multiple, not throat-clearing
4. **Background noise**: fans, AC, phones, talking — all add high-frequency noise the model wasn't trained on
5. **Sample rate**: the service resamples to 16kHz, so any mic sample rate ≥ 16kHz works

---

## Known Limitations

1. **Single-cough analysis**: The model uses one peak-centered slice. Multiple coughs in the same recording are ignored.
2. **Dataset bias**: Trained on specific cough recording setups. Accuracy may vary with different mics, room acoustics, or patient populations.
3. **Not diagnostic**: This is a screening tool. Sensitivity/specificity should be validated against local population data.
4. **Non-TB respiratory diseases**: COPD and Pneumonia classification is a secondary screening after TB is ruled out. Accuracy is lower than TB detection.
5. **Short recordings**: Audio < 0.5s total duration will be padded with silence, which degrades results.

---

## Model Files

| File | Source | Size |
|------|--------|------|
| `models/tb_gatekeeper_resnet18.onnx` | Exported from PyTorch training | ~45MB |
| `models/respiratory_classifier_resnet18.onnx` | Exported from PyTorch training | ~45MB |
| `models/tb_gatekeeper_resnet18.pth` | Raw PyTorch weights (optional) | ~45MB |
| `models/respiratory_classifier_resnet18.pth` | Raw PyTorch weights (optional) | ~45MB |
