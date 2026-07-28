# COUGHPH v1 — Design Doc (Updated Post-CEO Review)

## Problem Statement
A web app for analyzing cough sounds to screen for **COPD, Tuberculosis, Pneumonia, and Healthy** — validated against real clinician diagnoses. Target: single clinic/hospital deployment with high-volume screening.

**Users**: Clinicians (screen, view history), Admins (manage clinicians, audit all data), Patients (screened by clinician, no portal)

**Core Pain**: Delayed diagnosis, overburdened clinics, need for non-invasive triage aid.

---

## Architecture Decisions (Locked In)

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **Backend** | FastAPI | Auto-docs, type safety, async, better than Flask for ML serving |
| **Database** | PostgreSQL (Supabase) | Free tier, managed, auth built-in, scales to clinic volume |
| **Auth** | Supabase Auth | Magic links / email+password, JWT, row-level security |
| **Frontend** | React + Tailwind CSS + Vite | Professional clinical UI, component-based, great DX |
| **ML Serving** | ONNX Runtime (separate process) | ResNet18 → ONNX, CPU-optimized, decoupled from API |
| **Audio Processing** | librosa (server-side) | Peak detection, dual-slice (0.34s / 2.0s), Log-Mel 64-mel |
| **Inference Flow** | TB Gatekeeper (0.34s) → if Non-TB → Respiratory (2.0s) | Cascade architecture (resource-constrained training) |
| **Hosting** | Vercel (frontend) + Supabase (DB/Auth) + Mini-computer (inference) | Free tiers for web, dedicated GPU/CPU for ML |
| **PDF Export** | ReportLab / WeasyPrint | Doctor page: export filtered/sorted patient table |
| **Audit Logs** | `created_at` on screening record + doctor login/logout table | Compliance-ready, shown inline in patient table |

---

## CEO Review Decisions

| Decision | Choice | Notes |
|----------|--------|-------|
| **Scope** | Multi-clinic ready from day one | Admin panel included; multiple clinicians expected |
| **Admin Panel** | In MVP | Clinician approval, audit logs, record management |
| **Risk Level Display** | Removed | Only % per class + recommendations per condition |
| **COPD risk** | Moderate | |
| **Pneumonia/TB risk** | High | |
| **Healthy** | Green | |

---

## MVP Scope (Must-Have)

| Feature | Details |
|---------|---------|
| **Auth** | Clinician register → admin approve → login (Supabase Auth) |
| **New Patient Form** | Name, DOB (auto-age), gender, **smoking**, **past respiratory diseases**, symptoms (checklist: headache, fever, dry cough, wet cough, etc.) |
| **Screening Page** | Record/upload cough (≤5MB) → dual-model inference → result page |
| **Result Page** | % per class (4 classes), recommendations per condition (no risk level) |
| **Patient History (Doctor)** | Table: sortable by date, condition, gender, age bracket (0-12,13-21,22-35,35+), search by name, audit column (saved-at timestamp) |
| **Admin Panel** | All doctor data + approve/reject/delete clinicians, delete any patient record, view doctor login/logout times |
| **UI/UX** | Clinical/professional + modern, Tailwind, subtle animations, not "AI slop" |

---

## Deferred to Phase 2
- PDF reports (doctor export)
- Email notifications
- Multi-language
- Patient portal
- Model retraining pipeline
- Advanced audit logs (beyond created_at + login/logout)

---

## Technical Specifications

### 1. ONNX Conversion
- ResNet18 `.pth` → ONNX with **dynamic axes for batch size**
- Both models: `tb_gatekeeper_resnet18.onnx`, `respiratory_classifier_resnet18.onnx`

### 2. Inference Service (Separate FastAPI)
- Runs locally on `http://localhost:8000`
- REST API, accepts `multipart/form-data` audio files
- Returns JSON inference results with **`model_version` metadata**
- **Structured JSON error handling** (consistent error envelopes)
- Code structured to re-point to local network IP for dedicated hardware migration
- Endpoint: `POST /api/inference` → `{ job_id }` or direct result
- Async: `GET /api/status/{job_id}` for polling

### 3. Supabase RLS
- Policies: clinicians see own patients; admins see all
- Row-level security enabled on all patient tables
- **Multi-clinic ready**: `clinic_id` on all tables from day one

### 4. Audio Upload
- Via backend (FastAPI) → Supabase Storage or local temp → inference service
- Not direct from frontend

### 5. Real-time Inference
- Standard HTTP POST from frontend
- Loading state while awaiting JSON response
- If async: lightweight polling `GET /api/status/{job_id}` (no WebSockets)

---

## Engineering Review Decisions (Locked In)

| Decision | Choice |
|----------|--------|
| **Inference Topology** | Network REST API on FastAPI (http://localhost:8000) |
| **Error Handling** | Structured JSON error envelopes |
| **Model Versioning** | `model_version` in API payloads |
| **Testing** | pytest for backend inference testing |
| **Model Loading** | Load ONNX sessions at startup (memory-resident) |
| **Concurrency** | Fixed worker pool = CPU cores - 1 |
| **Audio Validation** | Strict at API gateway: MIME, duration ≤30s, 16kHz mono |
| **Observability** | Structured JSON logs + Sentry free tier |

---

## Design Review Decisions (Locked In)

| Decision | Choice |
|----------|--------|
| **Component Library** | shadcn/ui (Radix UI) — WCAG AA accessible |
| **Color Palette** | Slate/Blue clinical neutrals |
| **Diagnostic Indicators** | Green (Healthy), Amber (COPD/Moderate), Red (Pneumonia/TB/High) |
| **Risk Mapping** | COPD=Moderate/Amber, Pneumonia=High/Red, TB=High/Red, Healthy=Green |
| **Dark/Light Mode** | Toggleable (user preference persisted in localStorage) |
| **Print Stylesheet** | Minimal `@media print` — hides nav, white background, clean result card |
| **Loading States** | Skeleton screens (shadcn/ui `Skeleton` component) |

---

## DevEx Review Decisions (Locked In)

| Decision | Choice |
|----------|--------|
| **API Contract** | FastAPI auto-generated OpenAPI spec |
| **Type Sharing** | openapi-typescript → React TypeScript types |
| **Backend Testing** | pytest for inference testing |
| **Shared Types Package** | `@coughph/types` (local npm/GitHub Packages) |
| **Test Pyramid** | pytest (backend/inference), Vitest (frontend), Playwright (integration/E2E) |
| **Local Dev** | Docker Compose (PostgreSQL, backend, inference, frontend) |

---

## Local-First Development
**Build entirely on local machine first.** No deployment until you're satisfied.
- Frontend: `npm run dev` (Vite + React + Tailwind + shadcn/ui)
- Backend: `uvicorn main:app --reload` (FastAPI on :8000)
- Inference: separate FastAPI on :8001 (or same with route prefix)
- Database: local PostgreSQL (Docker) or Supabase local dev
- ML models: local `.onnx` files

---

## Remaining Open Questions

### Engineering Review
1. **Model loading**: Load ONNX models at startup (memory) or lazy-load per request?
2. **Concurrency**: How many simultaneous inferences? Worker pool size?
3. **Audio validation**: MIME type, duration limits, sample rate enforcement?
4. **Error telemetry**: Sentry? Structured logs to file?

### Design Review
1. **Dark mode**: Support from day one or defer?
2. **Print stylesheet**: For result page (clinician may print)?
3. **Loading states**: Skeleton screens vs spinners for inference wait?

### DevEx Review
1. **Monorepo vs separate repos**: Frontend/backend/inference in one repo?
2. **CI pipeline**: GitHub Actions — lint, typecheck, test, build?
3. **Local dev script**: Single command to spin up all services (docker-compose)?