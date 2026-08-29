# Scope and Limitations

## System Overview

AURA-Dx is a web-based AI screening system for early detection of respiratory diseases via cough sound analysis. The system implements a two-stage cascade classification pipeline deployed on a local mini-computer in clinical settings.

---

## Classification Pipeline

### Stage 1: TB Gatekeeper (Binary Classifier)
- **Task**: Distinguish TB vs Non-TB cough sounds
- **Classes**: `Non-TB`, `TB`
- **Input**: 0.45-second audio slice centered on peak amplitude
- **Features**: Log-Mel spectrogram (64 mel bands, 16kHz, n_fft=1024, hop_length=256) → min-max normalized → 3-channel 224×224 RGB tensor
- **Architecture**: ResNet-18 (ImageNet pretrained, fine-tuned)
- **Training Data**: TB Gatekeeper dataset (~2,344 samples, 50/50 split)
- **Validation Performance**: 96.6% accuracy, 96.7% macro F1

### Stage 2: Respiratory Classifier (3-Class Classifier)
- **Task**: Classify non-TB respiratory conditions
- **Classes**: `Healthy`, `Pneumonia`, `COPD`
- **Trigger**: Only executes when Stage 1 predicts `Non-TB`
- **Input**: 2.0-second audio slice centered on peak amplitude
- **Features**: Identical preprocessing pipeline (Log-Mel → 224×224×3)
- **Architecture**: ResNet-18 (ImageNet pretrained, fine-tuned)
- **Training Data**: Respiratory dataset (~1,165 samples, 3-class)
- **Validation Performance**: 90.6% accuracy, 90.5% macro F1

### Cascade Logic
```
Audio Input → TB Gatekeeper
    ├─ TB → STOP (Result: TB, High Priority)
    └─ Non-TB → Respiratory Classifier → Result: Healthy / Pneumonia / COPD
```

---

## Hardware Configuration

| Component | Specification | Role |
|-----------|---------------|------|
| **Mini Computer** | Raspberry Pi 5 (8GB) or Intel NUC (i3/i5 8th gen+) | Hosts inference service (FastAPI + ONNX Runtime), web dashboard, database |
| **Microphone** | USB condenser (Blue Snowball iCE / Fifine K669B / ReSpeaker 4-Mic Array) | Captures cough audio at 16kHz mono |
| **Webcam** | Logitech C920 / C922 (1080p UVC) | Captures patient video for clinical context (optional) |
| **Network** | Local LAN / Wi-Fi | Communication between dashboard and inference service |

**No ESP32-S3 / INMP441** — Audio capture and inference run entirely on the mini-computer.

---

## Software Stack

- **Inference Service**: FastAPI + ONNX Runtime (CPUExecutionProvider)
- **Backend API**: FastAPI + Supabase (PostgreSQL + Auth + Realtime)
- **Frontend Dashboard**: React + TypeScript + Tailwind CSS
- **Model Format**: ONNX (exported from PyTorch ResNet-18)
- **Audio Processing**: librosa (Mel-spectrogram extraction matching training pipeline)

---

## Scope

### Included
1. **Automated cough screening** via two-stage cascade AI model
2. **Clinical workflow integration**: Patient registry, screening history, clinician review/override
3. **PDF report generation** with probability distributions and clinical recommendations
4. **Role-based access** (Super Admin, Admin, Clinician) with clinic scoping
5. **Audit logging** for all clinical actions
6. **Real-time dashboard** for screening management
7. **Clinician second-read workflow** — clinicians review AI results and confirm/disagree

### Excluded
1. **No vital signs integration** — temperature, SpO₂, blood pressure, labs, imaging
2. **No diagnostic certainty** — system outputs screening probabilities only
3. **No pediatric-specific models** — trained on adult cough data
4. **No real-time streaming inference** — processes uploaded audio files
5. **No cloud dependency for inference** — runs fully offline on local hardware

---

## Limitations

### 1. Clinical Scope
- **Screening tool only** — Does not replace professional medical diagnosis. All results require clinician review.
- **Limited disease coverage** — Detects TB, Pneumonia, COPD, Healthy. Does not cover: Asthma, Bronchitis, COVID-19, Cold, Lung Cancer, Interstitial Lung Disease, etc.
- **No comorbidity modeling** — Single-label classification; patients with multiple conditions may be misclassified.

### 2. Data & Model Limitations
- **Training dataset bias** — Models trained on specific datasets (TB Gatekeeper + Respiratory) which may not represent local population demographics, recording conditions, or disease prevalence.
- **Class imbalance** — Respiratory classifier has fewer COPD samples (recall 80.8% vs 93-97% for other classes).
- **No cough-vs-background separation stage** — Assumes uploaded audio contains cough. Non-cough sounds (speech, ambient noise) may produce unreliable predictions.
- **Fixed slice durations** (0.45s / 2.0s) — May truncate relevant audio or include irrelevant segments.

### 3. Environmental Factors
- **Acoustic variability** — Room acoustics, background noise (HVAC, conversations, equipment), microphone placement, and patient-mic distance affect spectral quality.
- **Microphone dependency** — Frequency response and SNR vary across USB mic models; system calibrated for cardioid condensers ~30-50cm from mouth.
- **No real-time noise suppression** — Relies on model robustness; heavy noise degrades performance.

### 4. Deployment Constraints
- **Laboratory/clinical prototype** — Not validated for home use, outdoor environments, or telehealth without controlled recording setup.
- **Single-site validation** — Clinical validation planned at one hospital/clinic; generalizability unproven.
- **Regulatory status** — Not cleared by FDA, CE, or Philippine FDA. Research-use only.
- **Hardware coupling** — Inference service expects specific ONNX model paths and preprocessing parameters; model updates require service restart.

### 5. Evaluation Scope
- **Metrics**: Latency (inference time), Classification accuracy (per-class + macro), Clinician agreement rate (AI vs clinician diagnosis)
- **ISO/IEC 25010** — Evaluated on: Functional Suitability, Performance Efficiency, Usability, Reliability. Not evaluated: Security, Maintainability, Portability.
- **No longitudinal study** — No data on model drift, seasonal variation, or long-term clinician adoption.

---

## Definition of Terms

| Term | Definition |
|------|------------|
| **Artificial Intelligence (AI)** | Computer technology enabling systems to analyze data, recognize patterns, and make predictions analogous to human decision-making. |
| **Cough Sound Analysis** | Process of recording and examining cough audio signals to identify acoustic patterns associated with respiratory pathology. |
| **Edge AI** | Running AI models locally on embedded or edge devices (e.g., mini-computer) without cloud connectivity. |
| **Log-Mel Spectrogram** | Time-frequency representation of audio where frequencies are mapped to the Mel scale (perceptually linear) and amplitude converted to decibels (log). |
| **Mel-Frequency Cepstral Coefficients (MFCC)** | Compact representation of spectral envelope derived from Mel-spectrogram via DCT; not used in this system (raw Log-Mel used instead). |
| **ONNX (Open Neural Network Exchange)** | Open format for representing ML models; enables inference across frameworks (PyTorch → ONNX Runtime). |
| **ResNet-18** | 18-layer residual convolutional neural network; pretrained on ImageNet, fine-tuned on spectrogram images. |
| **Cascade Classifier** | Multi-stage pipeline where early-stage output gates later-stage execution (here: TB gate → respiratory classifier). |
| **Screening Tool** | Clinical test designed to identify individuals who may have a condition, requiring confirmatory diagnostic testing. |
| **Clinician Second-Read** | Workflow where a qualified clinician reviews AI output and provides independent diagnosis for comparison/validation. |
| **ISO/IEC 25010** | International standard for software product quality evaluation across eight characteristics. |

---

## Hardware Recommendations (Student-Friendly)

| Item | Recommended | Budget Option | Notes |
|------|-------------|---------------|-------|
| **Mini PC** | Raspberry Pi 5 (8GB) — ~$80 | Used Intel NUC i3 8th gen — ~$100 | Pi 5 runs ONNX Runtime CPU ~200ms/inference |
| **USB Mic** | Blue Snowball iCE — $50 | Fifine K669B — $35 | Cardioid pattern rejects room noise |
| **Mic (Alt)** | ReSpeaker 4-Mic Array for Pi — $35 | — | Mounts on Pi, hardware beamforming + noise suppression |
| **Webcam** | Logitech C920/C922 — $60-80 used | Any 1080p UVC cam — $25+ | UVC = driverless on Linux |

**Recommended Student Kit**: Pi 5 (8GB) + ReSpeaker 4-Mic Array + C920 = ~$175 total. Runs fully offline, no laptop tether.

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-08-11 | Initial scope based on two-model cascade (TB Gatekeeper + Respiratory), mini-PC deployment, clinician second-read workflow |