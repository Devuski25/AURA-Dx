# AURA-Dx — Design

Current architecture. Supersedes the COUGHPH v1 design doc; the cascade,
schemas and routes below all changed in v2.5.

---

## Architecture

```
Supabase (Postgres + GoTrue)   Inference :8000   Backend :8001   Frontend :5174
  auth.users, RLS, storage       FastAPI          FastAPI          React 19 + Vite
  clinics, profiles              XGBoost + TF      JWT + roles     Tailwind v4
  patients, screenings           librosa           ReportLab       shadcn/ui
  audit_logs
```

The frontend calls the backend directly at `api.auradx.xyz`. The Cloudflare
Worker serves static assets only and has no API logic.

| Service | Entry | Stack |
|---|---|---|
| Inference | `packages/inference/inference_service.py` | FastAPI, XGBoost, TensorFlow/Keras, librosa |
| Backend | `backend/main.py` | FastAPI, supabase-py, python-jose, ReportLab |
| Frontend | `frontend-new/src/App.tsx` | React 19, Vite 8, TS 6, Tailwind v4 |
| Database | `supabase/config.toml` | PostgreSQL 17, GoTrue Auth, RLS |

---

## Models

Two-stage cascade, fused across 3–5 takes. Full detail in `MODEL_CARD.md`.

| Stage | Model | Task | Output | Threshold |
|---|---|---|---|---|
| 1.5 | XGBoost, 153-d tabular | Healthy vs pathological | `p_healthy` | 0.61 |
| 2.5 | EfficientNetB0, 64×128×3 log-mel | Pneumonia vs COPD | `p_pneumonia` | 0.47 |

Stage 1 terminates a take as Healthy without running Stage 2. Fusion averages
across takes, then applies a single-take safety override at 0.60.

Preprocessing constants come from `final icbhi nb.ipynb` and are **not**
interchangeable between the two stages — Stage 1 uses librosa defaults
(`n_fft=2048`), Stage 2 uses `n_fft=1024`.

---

## Database

### Tables

| Table | Holds |
|---|---|
| `auth.users` | Supabase identities, incl. Google OAuth |
| `clinics` | Clinic records |
| `profiles` | Clinician and admin accounts, 1:1 with `auth.users` |
| `patients` | Patient demographics |
| `screenings` | Screening results |
| `audit_logs` | Login and action logging |
| `email_verification_codes` | OTP codes for Resend email |

### `screenings` columns

```
id, patient_id, clinic_id, clinician_id
audio_file_path        -- canonical take, first of the batch
recording_paths        -- all 3-5 takes
recording_scores       -- {per_clip: [...], fusion: {...}}
audio_duration_sec
respiratory_result, respiratory_confidence, respiratory_probabilities
cascade_path, model_version, status
reviewed_by, reviewed_at, review_notes
camera_data            -- retired feature, retained, never written
created_at, updated_at
```

`tb_result`, `tb_confidence` and `tb_probabilities` were **renamed** to
`*_archived` in v2.5, not dropped. Historical TB classifications are medical
records and are not destroyed. Nothing reads or writes them.

### `screening_history_view`

Joins screenings to patients, clinics and both clinician profiles. Rebuilt by
migration `20261012000000` — the earlier recreation had dropped `updated_at` and
`smoking_history`, which silently pushed every list and detail read onto the
base-table fallback.

---

## Frontend routes

| Route | Auth | Page |
|---|---|---|
| `/` | public | Home |
| `/about` | public | About |
| `/team` | public | Team |
| `/legal` | public | Legal |
| `/help-support` | public | HelpSupport |
| `/login`, `/register` | public | Auth |
| `/auth/callback`, `/reset-password` | public | OAuth callback |
| `/dashboard` | clinician+ | Dashboard |
| `/dashboard/screening` | clinician+ | Screening |
| `/dashboard/patient-records`, `/dashboard/screenings` | clinician+ | PatientRecords |
| `/dashboard/patients/:id` | clinician+ | PatientDetail |
| `/dashboard/screenings/:id` | clinician+ | ScreeningDetail |
| `/dashboard/admin` | admin+ | Admin |

`patient-records` and `screenings` render the same page. `screenings` is kept as
an alias so existing bookmarks resolve.

---

## Screening flow

1. Clinician selects or creates a patient
2. Records **3 to 5** separate stethoscope takes; each is playable and
   individually removable
3. Submit uploads all takes in one multipart request —
   `POST /api/audio/upload` with repeated `audios` fields
4. `POST /api/screenings` receives `audio_file_paths` and calls the inference
   service with the whole batch
5. One fused verdict is written, alongside the per-take scores

Takes are **not** concatenated client-side. Each is scored independently and the
fusion step needs the per-take evidence.

---

## Auth

Supabase GoTrue. Email OTP through Resend (`smtp.resend.com`) and Google OAuth.
The backend verifies Supabase JWTs and enforces role from the `profiles` row,
never from the client.

The first registered user becomes `super_admin`; everyone after is `clinician`
with `pending` status, pending admin approval.

---

## Running it

The backend and inference services are **not** always-on.

```powershell
.\deploy\mini-pc\start-aura-services.ps1 start     # inference, then backend; health-checked
.\deploy\mini-pc\start-aura-services.ps1 status
.\deploy\mini-pc\start-aura-services.ps1 stop
.\deploy\mini-pc\start-aura-services.ps1 restart
```

PID files and logs live in `%LOCALAPPDATA%\AURA-Dx`, outside the repo.

Frontend: `cd frontend-new && npm run dev`.

---

## Known issues

- **No end-to-end accuracy measurement** for the deployed configuration. Per-stage
  figures exist; the cascade as a whole has not been measured. See
  `MODEL_CARD.md`.
- **Train/serve skew in the training notebook.** The service implements the
  correct path; the notebook's evaluation path does not.
- **Stage 1 feature layout is order-sensitive** and a silent-failure risk.
  Guarded by `test_feature_layout.py`.
- **Audio files are unencrypted at rest** on the backend host.
- **No inconclusive band.** Near-even probabilities are reported like confident ones.
- **Migration ordering.** Starting a backend that references new columns before
  its migration has been applied produces a 500 on screening creation, not a
  startup failure.