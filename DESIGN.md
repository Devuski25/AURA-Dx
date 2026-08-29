# COUGHPH v1 — Design Doc (Updated 2026-07-29)

## Problem Statement
A web app for analyzing cough sounds to screen for **COPD, Tuberculosis, Pneumonia, and Healthy** — validated against real clinician diagnoses. Target: single clinic/hospital deployment with high-volume screening.

**Users**: Clinicians (screen, view history), Admins (manage clinicians, audit all data), Patients (screened by clinician, no portal)

**Core Pain**: Delayed diagnosis, overburdened clinics, need for non-invasive triage aid.

---

## Architecture Decisions (Locked In)

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **Backend** | FastAPI (`backend/main.py`) | Auto-docs, type safety, async, replaces legacy Flask (`backend/app.py` — dead code) |
| **Database** | PostgreSQL (Supabase local) | Local dev at `127.0.0.1:54321`, 7 migration files applied |
| **Auth** | Supabase Auth + JWT + `profiles` table | Email/password, JWT decoded by backend, role & clinic_id fetched from DB per request |
| **Frontend** | React 19 + Vite + Tailwind CSS v4 + shadcn/ui | Professional clinical UI, component-based, `frontend-new/` |
| **ML Serving** | ONNX Runtime (separate process on `:8000`) | ResNet18 → ONNX, CPU-optimized, decoupled from API at `packages/inference/inference_service.py` |
| **Audio Processing** | librosa (server-side in inference service) | Peak-centered slice, 224-mel Log-Mel (n_fft=512, hop=160), stack to 3-ch, ImageNet normalize |
| **Inference Flow** | TB Gatekeeper (0.34s slice) → if Non-TB → Respiratory Classifier (2.0s slice) | Cascade architecture; models: `tb_gatekeeper_resnet18.{pth,onnx}`, `respiratory_classifier_resnet18.{pth,onnx}` |
| **Inference Service** | `POST /api/inference` multipart audio → JSON result | Lives at `packages/inference/inference_service.py`, port 8000 |
| **Hosting** | Vercel (frontend) + Supabase (DB/Auth) + Mini-computer (inference) | Free tiers for web, dedicated CPU for ML |
| **PDF Export** | Backend endpoint `GET /api/screenings/{id}/pdf` | ReportLab |
| **Audit Logs** | `audit_logs` table with action, entity_type, entity_id, details JSON | Compliance-ready |

### Backend Layout

```
backend/
  main.py          — FastAPI app (ACTIVE, port 8001)
  app.py           — Legacy Flask + SQLite + PyTorch (DEAD CODE — orphaned)
  config.py        — Settings: INFERENCE_SERVICE_URL, SUPABASE_URL, JWT_SECRET
  routes/api.py    — All API endpoints (patients, screenings, audio, auth)
  models.py        — Pydantic models (PatientCreate, ScreeningCreate, etc.)
  auth.py          — JWT decode, get_current_user, require_role dependencies
  audio_utils.py   — Old PyTorch DSP pipeline (torchaudio, scipy Butterworth, 64-mel)
```

---

## Discrepancies (Reality vs Original Design)

| Original Design | Reality | Impact |
|----------------|---------|--------|
| Inference on `:8000`, Backend on `:8001` | Same — correct | — |
| Audio processing: 64-mel Log-Mel | ONNX pipeline uses **224-mel** (n_fft=512, hop=160), old PyTorch pipeline uses 64-mel (n_fft=1024, hop=256) | Preprocessing mismatch between training and serving — needs verification |
| Low-pass filter @ 3000Hz (Butterworth) in audio pipeline | ONNX pipeline has NO low-pass filter | Outputs may differ from training — needs testing against known diagnoses |
| `clinic_id` seeded in migration | Migration existed but local Supabase was reset — `clinics` table empty, all profiles had `clinic_id = null` | Patient creation failed with 500 until manually fixed |
| Structured JSON error envelopes | Backend returns generic 500 errors with no detail | Needs middleware to catch and format errors |
| Async inference with job polling (`POST → job_id`, `GET /status`) | Synchronous HTTP POST — frontend waits for response | Browser may time out on slow devices |
| Worker pool = CPU cores - 1 | No worker pool — unlimited concurrent inference | CPU contention under load |
| Audio validation (MIME, ≤30s, 16kHz mono) | No validation — any file accepted | Bad audio wastes inference time |
| Supabase RLS on all tables | RLS policies applied, some may be permissive locally | OK for local dev, needs audit before prod |
| shadcn/ui uses Radix Checkbox | Custom native `<input type="checkbox">` wrapper | No a11y issues, but deviates from Radix |
| Admin nav has "New Screening" | Admin nav: Dashboard, Patients, Users (no New Screening) | Admin cannot create screenings — by design? |
| `model_version` in all inference payloads | Present — `"1.0.0"` | — |
| ONNX models in `models/` | Both `.pth` and `.onnx` exist | ONNX is the serving format |

---

## CEO Review Decisions

| Decision | Choice | Notes |
|----------|--------|-------|
| **Scope** | Multi-clinic ready from day one | Admin panel included; `clinic_id` on all tables |
| **Admin Panel** | In MVP | Clinician approval, audit logs, record management |
| **Risk Level Display** | Removed | Only % per class + recommendations per condition |
| **COPD risk** | Moderate (yellow) | |
| **Pneumonia/TB risk** | High (red) | |
| **Healthy** | Low (green) | |

---

## MVP Scope (Implemented)

| Feature | Details |
|---------|---------|
| **Auth** | Register → admin approve → login (Supabase Auth). Approved first-login clinicians see confirmation dialog. |
| **New Patient Form** | Name, DOB (auto-age in read-only field), Gender, Smoking (Yes/No radio), Past Respiratory Diseases (pill checkboxes + "None of the above"), Symptoms (pill checkboxes + "None of the above"). No pack years. No Night sweats. |
| **Screening Flow (3-step)** | Step 1: Select/Create patient → Step 2: Record mic or upload .wav → Step 3: View TB + Respiratory results with % and clinical recommendations |
| **Screening Records** | Table with search (patient name), Class filter (All/TB/Healthy/COPD/Pneumonia), Gender filter (All/Male/Female), sortable columns. Detail dialog with full results. |
| **Patients Page** | List with search, add/edit/delete. All clinicians see all patients (single-clinic deployment). |
| **Result Page** | % per class (TB/Non-TB + Healthy/COPD/Pneumonia), cascade info, confidence bars, clinical recommendations per condition. |
| **Admin Panel** | User approval/rejection, role management, system metrics. |
| **Audit Logs** | `audit_logs` table: patient_create, screening_create, user_approve, etc. |
| **UI/UX** | Clinical/professional, Tailwind CSS v4, shadcn/ui components, mobile-responsive sidebar. |

### Not Yet Implemented (from MVP)
- PDF reports on Screening Records page (endpoint exists but not tested from UI)
- Age bracket filter on Screening Records (removed in scope reduction)
- Doctor login/logout audit table
- Dashboard statistics page is basic

---

## Deferred to Phase 2
- PDF reports (doctor export — endpoint exists, needs UI polish)
- Email notifications
- Multi-language
- Patient portal
- Model retraining pipeline
- Advanced audit logs (beyond created_at + login/logout)
- Async inference with job polling
- Audio validation (MIME, duration, sample rate)
- Worker pool limiting
- Structured JSON error envelopes

---

## Technical Specifications

### 1. Models

Both model formats exist at `models/`:

| Model | PyTorch | ONNX | Purpose |
|-------|---------|------|---------|
| TB Gatekeeper | `tb_gatekeeper_resnet18.pth` | `tb_gatekeeper_resnet18.onnx` | Binary TB vs Non-TB (0.34s audio) |
| Respiratory Classifier | `respiratory_classifier_resnet18.pth` | `respiratory_classifier_resnet18.onnx` | 3-class Healthy/COPD/Pneumonia (2.0s audio) |

ONNX conversion via `packages/inference/export_onnx.py` with dynamic batch axes.

### 2. Inference Pipeline (ONNX — Active)

```
audio file → soundfile.read() → librosa.resample(16000)
  → peak-centered slice (0.34s or 2.0s)
  → librosa.feature.melspectrogram(224-mel, n_fft=512, hop_length=160)
  → log(1 + mel_spec) → stack (3, 224, time) → ImageNet normalize
  → ONNX Runtime session.run()
```

**Differences from training pipeline** (see `backend/audio_utils.py`):
- No Butterworth low-pass filter @ 3000Hz
- N_MELS=224 vs 64
- n_fft=512 vs 1024
- hop_length=160 vs 256
- Stack 3 channels vs repeat 1→3 then resize

### 3. Inference Service (`packages/inference/inference_service.py`)

- FastAPI on port 8000
- `POST /api/inference` — multipart form with `audio` file → JSON result
- `GET /health` — model loaded check
- Loads both ONNX sessions at startup
- Returns: `{ tb_result: {label, confidence, probabilities}, respiratory_result: {...}, cascade, model_version }`
- Backend calls it at `routes/api.py:512-518` via `settings.inference_service_url`

### 4. Supabase Schema

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `profiles` | User accounts | id, clinic_id, email, full_name, role, status |
| `clinics` | Clinic registry | id, name, address, is_active |
| `patients` | Patient records | id, clinic_id, clinician_id, full_name, gender, smoking_history |
| `screenings` | Screening results | id, patient_id, tb_result, respiratory_result, cascade_path, audio_file_path |
| `audit_logs` | Activity trail | user_id, action, entity_type, entity_id, details (JSONB) |

Views: `patient_list_view`, `screening_history_view`

### 5. Auth Flow

1. User signs in via Supabase Auth (email + password)
2. Frontend stores `access_token` from session
3. Backend `auth.py:decode_token()` decodes JWT (ES256 or HS256)
4. If JWT role is `"authenticated"` (not clinician/admin/super_admin), fetches real role + `clinic_id` from `profiles` table
5. `require_role()` dependency gates endpoints by role
6. `clinic_id` from profile is used to scope all queries

> **Single-clinic deployment:** All clinicians see all patients and screening records — no per-doctor scoping. Patient `clinician_id` is stored for audit only and does not restrict access.

### 6. Frontend Routes

| Path | Component | Description |
|------|-----------|-------------|
| `/login` | `Login.tsx` | Supabase email/password sign-in |
| `/register` | `Register.tsx` | New user registration |
| `/dashboard` | `Dashboard.tsx` | Stats overview |
| `/dashboard/screening` | `Screening.tsx` | 3-step: patient → record → result |
| `/dashboard/screenings` | `Screenings.tsx` | Screening history table |
| `/dashboard/patients` | `Patients.tsx` | Patient CRUD |
| `/dashboard/patients/:id` | `PatientDetail.tsx` | Single patient view |
| `/dashboard/screenings/:id` | `ScreeningDetail.tsx` | Single screening view |
| `/dashboard/admin` | `Admin.tsx` | User management (admin/super_admin only) |

### 7. Frontend Components (shadcn/ui)

- `NewPatientModal.tsx` — Patient creation form in Dialog (the only form using shadcn `Form` + `FormField`)
- `Layout.tsx` — Sidebar + header layout, conditional nav (clinician vs admin)
- Checkbox is a custom native `<input type="checkbox">` wrapper (not Radix)
- Select is shadcn `Select` (Radix-based)
- Badges for TB (destructive/success) and Respiratory (success/warning/destructive)

---

## Known Issues & Open Items

### Critical
- **ONNX vs PyTorch preprocessing mismatch** — different mel params and no low-pass filter. Need to test both pipelines against known diagnoses to verify outputs converge.
- **`clinic_id` seed data missing** — local Supabase resets lose the default clinic. Must manually insert before creating patients (see SETUP.md).

### Minor
- `FormMessage` in `NewPatientModal` didn't display errors (fixed — was missing `fieldState.error`)
- Nested `<form>` in `NewPatientModal` prevented form submission (fixed)
- Audio upload `.wav` MIME type check too strict — Windows may send `audio/x-wav`
- `accessToken` null guard silently returns (fixed — now shows toast)
- No loading skeleton for inference wait (spinner only)
- Backend returns generic 500 with no error detail

### Removed (by design — single-clinic deployment)
- **Per-clinician patient/screening scoping** — removed. All clinicians see all patients and screening records.
- **"Not your patient" / "Not your screening" checks** — removed. `clinician_id` is recorded for audit only.

---

## Engineering Review Decisions (Locked In)

| Decision | Choice |
|----------|--------|
| **Inference Topology** | Network REST API on FastAPI (http://localhost:8000) |
| **Error Handling** | Generic 500 — structured JSON envelopes deferred |
| **Model Versioning** | `model_version` in API payloads (`"1.0.0"`) |
| **Testing** | No automated tests yet |
| **Model Loading** | Load ONNX sessions at startup (memory-resident) |
| **Concurrency** | No worker pool — deferred |
| **Audio Validation** | None — deferred |
| **Observability** | Console logs only |
| **Active Backend** | FastAPI `backend/main.py` (Flask `backend/app.py` is dead) |

---

## Design Review Decisions (Locked In)

| Decision | Choice |
|----------|--------|
| **Component Library** | shadcn/ui (custom Checkbox, Radix Select/Select content/Dialog) |
| **Color Palette** | Slate/Blue clinical neutrals |
| **Diagnostic Indicators** | Green (Healthy), Amber (COPD/Moderate), Red (Pneumonia/TB/High) |
| **Risk Mapping** | COPD=Moderate/Amber, Pneumonia=High/Red, TB=High/Red, Healthy=Green |
| **Dark/Light Mode** | Not implemented (light only) |
| **Print Stylesheet** | Not implemented |
| **Loading States** | Spinners only (no skeletons) |

---

## DevEx Review Decisions (Locked In)

| Decision | Choice |
|----------|--------|
| **API Contract** | FastAPI auto-generated OpenAPI spec at `/docs` |
| **Type Sharing** | None (manual TypeScript types) |
| **Backend Testing** | None |
| **Shared Types Package** | None |
| **Test Pyramid** | None implemented |
| **Local Dev** | Manual — 4 terminals (supabase, inference, backend, frontend) |
| **Monorepo** | Yes — all in one repo |
| **CI Pipeline** | None |
