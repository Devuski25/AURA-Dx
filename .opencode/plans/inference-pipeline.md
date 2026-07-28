# COUGHPH Inference Pipeline — Full Plan

## Architecture Overview

```
┌─────────────┐  HTTP     ┌──────────────┐  HTTP     ┌───────────────────┐
│  Frontend   │ ────────→ │  Backend API │ ────────→ │ Inference Service │
│  (:5173)    │ ←──────── │  (:8001)     │ ←──────── │  (:8000)          │
│ React/Vite  │            │  FastAPI     │            │  FastAPI          │
│             │            │  Supabase DB │            │  ONNX Runtime     │
│             │            │  Supabase    │            │  librosa          │
└─────────────┘            │  Auth/JWT    │            │  (mini-computer)  │
                           └──────────────┘            └───────────────────┘
```

## Current State

### What's Already Built (Complete)

| Component | Location | Status |
|-----------|----------|--------|
| **Inference Service** | `packages/inference/inference_service.py` | ✅ Fully coded — FastAPI app with `POST /api/inference` + `GET /health` |
| **ONNX Models** | `models/tb_gatekeeper_resnet18.onnx` | ✅ Already converted |
| | `models/respiratory_classifier_resnet18.onnx` | ✅ Already converted |
| **PyTorch Models** | `models/tb_gatekeeper_resnet18.pth` | ✅ Exist |
| | `models/respiratory_classifier_resnet18.pth` | ✅ Exist |
| **ONNX Export Script** | `packages/inference/export_onnx.py` | ✅ Converts `.pth` → `.onnx` with dynamic batch axis |
| **Backend → Inference** | `backend/routes/api.py:512-518` | ✅ `run_inference()` sends audio to `http://localhost:8000/api/inference` |
| **Response format match** | Both use `{ tb_result: {label, confidence, probabilities}, respiratory_result: ..., cascade, model_version }` | ✅ Match |
| **Dependencies** | `packages/inference/requirements.txt` | ✅ onnx, onnxruntime, librosa, soundfile, fastapi, uvicorn |
| **Virtual Env** | `packages/inference/venv/` | ✅ Already created with all deps installed |
| **Test Audio** | `packages/inference/test_cough.wav` | ✅ Sample file |

### What Needs To Happen

The inference service exists on disk but is **not started**. Just one command needed.

---

## Phase 1: Running the Pipeline (Now)

### Step 1 — Start the Inference Service

```powershell
cd packages\inference
.\venv\Scripts\Activate.ps1
uvicorn inference_service:app --reload --host 0.0.0.0 --port 8000
```

Verify: `curl http://localhost:8000/health`

### Step 2 — Verify Full Stack

Start all 4 services:
1. Supabase: `npx supabase start` (in `supabase/`)
2. Inference: `uvicorn inference_service:app --reload --host 0.0.0.0 --port 8000` (in `packages/inference/`)
3. Backend: `uvicorn main:app --reload --host 0.0.0.0 --port 8001` (in `backend/`)
4. Frontend: `npm run dev` (in `frontend-new/`)

### Step 3 — End-to-End Test

1. Open `http://localhost:5173`
2. Login as clinician
3. New Screening → select/create patient
4. Upload test audio → Run Analysis
5. Verify result page shows TB/Respiratory classification

---

## Phase 2: PyTorch → ONNX Migration (For Mini-Computer)

### Current Inference Service Pipeline (librosa/ONNX)

```
audio → soundfile (load) → librosa (resample to 16kHz) 
     → peak-centered slice → librosa (224-mel Log-Mel, n_fft=512, hop=160)
     → stack to 3 channels → ImageNet normalize 
     → ONNX Runtime (TB Gatekeeper 0.34s OR Respiratory 2.0s)
```

### Legacy audio_utils.py Pipeline (torchaudio/scipy/PyTorch)

```
audio → soundfile (load) → torchaudio (resample) 
     → scipy Butterworth low-pass @ 3000Hz (zero-phase filtfilt)
     → peak-centered slice → torchaudio (64-mel Log-Mel, n_fft=1024, hop=256)
     → bilinear resize 64×time → 224×224
     → repeat 1ch→3ch → per-sample normalize → rescale → ImageNet normalize
     → PyTorch model forward
```

**⚠️ These produce different inputs.** Key differences:
- No low-pass filter in ONNX pipeline
- Different N_MELS (224 vs 64), N_FFT (512 vs 1024), HOP_LENGTH (160 vs 256)
- Different channel expansion (stack vs repeat)
- Different normalization order

### Migrating to Mini-Computer

The `.pth` → `.onnx` conversion is already done. The inference service is already written for ONNX.

1. Copy `packages/inference/inference_service.py` + `models/*.onnx` to device
2. Install `onnxruntime-arm` or compatible runtime
3. No code changes — same service runs on ARM
4. Update backend env: `inference_service_url=http://[mini-computer-ip]:8000`

---

## Phase 3: Post-MVP Enhancements

| Feature | Details |
|---------|---------|
| **Async job polling** | `POST /api/inference → {job_id}` + `GET /api/status/{job_id}` to prevent browser timeouts on slow devices |
| **Audio validation** | Enforce ≤30s duration, strict MIME check, 16kHz mono enforcement |
| **Structured errors** | Consistent `{ error, code, detail }` envelopes per DESIGN.md |
| **Worker pool** | `asyncio.Semaphore(max(1, cpu_count-1))` to limit concurrent inferences |
| **Preprocessing alignment** | If testing shows divergence, align ONNX pipeline with training pipeline (add Butterworth, match mel params) |
