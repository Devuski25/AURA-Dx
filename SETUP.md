# AURA-Dx — Complete Setup Guide

**Last updated:** August 16, 2026  
**OS:** Windows (PowerShell) · macOS · Linux  
**Ports:** Inference `8000` · Backend `8001` · Frontend `5174` · Supabase `54321`

---

## Prerequisites Check

| Tool | Check Command | Required Version |
|------|---------------|------------------|
| Node.js | `node --version` | v18+ |
| npm | `npm --version` | v9+ |
| Python | `python --version` | 3.13+ |
| Docker Desktop | `docker --version` | Any recent version |
| Supabase CLI | `supabase --version` | v2.109.1+ |

> **Docker Desktop must be running** before starting Supabase.

---

## Quick Start (Recommended) — One Command

> **Windows only.** macOS/Linux users follow the manual steps in Section 2+.

From the repo root, the `dev.ps1` manager starts/stops/restarts all 4 services:

```powershell
cd C:\Users\David\OneDrive\Documents\COUGHPH

.\dev.ps1 start      # Start all 4 services (Supabase -> Inference -> Backend -> Frontend)
.\dev.ps1 restart    # Cleanly stop everything (kills orphans), then start fresh
.\dev.ps1 stop       # Stop everything
.\dev.ps1 status     # Show which services are up + backend health detail
```

If blocked by execution policy:
```powershell
powershell -ExecutionPolicy Bypass -File .\dev.ps1 start
```

**Behavior:**
- `start` is **idempotent** — already-running services are skipped (safe to run anytime)
- Supabase starts first (30–60s on cold start), then inference, backend, frontend
- PIDs tracked in `.pids\`; `stop`/`restart` sweep ports 8000/8001/5174 to catch orphaned processes (never touches Docker/Supabase ports)
- All logs written to `logs\` (e.g. `logs\backend_err.log`)

> **NOTE:** The backend + frontend are configured to use the **production** Supabase project (`zczzviyyrrrmzmvjyigx.supabase.co`) for auth/DB. The local Supabase (`:54321`) can still be started via `dev.ps1` for migration/local-database work, but the running app talks to production.

---

## Step 1: Start Supabase (Local Database + Auth)

Only needed for local DB/migration work — the app uses production Supabase.

```bash
cd C:\Users\David\OneDrive\Documents\COUGHPH\supabase
npx supabase start
```

**Expected output:**
```
Started supabase local development setup.
         API URL: http://127.0.0.1:54321
          DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
      Studio URL: http://127.0.0.1:54323
    Inbucket URL: http://127.0.0.1:54324
```

Migration files in `supabase/migrations/` apply automatically to the **local** instance — creates `profiles`, `patients`, `screenings`, `clinics`, `audit_logs`, RLS policies, and views.

> **Production schema:** since the app uses production Supabase, schema changes must be applied there too. `supabase link --project-ref zczzviyyrrrmzmvjyigx` then `supabase db push` (review before pushing — prod data).

> **Status (Aug 16, 2026):** Production schema has been synced via `supabase/production_sync.sql` (creates `clinics` + Default Clinic seed, `patients`, `screenings` incl. `camera_data`, `audit_logs`, views, RLS, grants; assigns all profiles to the Default Clinic; never touches `profiles`/`auth.users`). A follow-up `supabase/production_fix1.sql` fixes two latent bugs (views missing `updated_at`; signup trigger not assigning `clinic_id`). Both files are re-runnable (idempotent).

### 1a. Seed default clinic

```sql
-- Run in Supabase Studio SQL Editor (http://127.0.0.1:54323 for local)
INSERT INTO clinics (id, name, address, phone, email, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Default Clinic',
  '123 Main St, City',
  '+1234567890',
  'clinic@coughph.local',
  true
) ON CONFLICT (id) DO NOTHING;

UPDATE profiles
SET clinic_id = '00000000-0000-0000-0000-000000000001'
WHERE clinic_id IS NULL;
```

---

## Step 2: Supabase Auth Setup (Email/Password + Google OAuth)

### 2a. Create `.env.local` files

**Backend** — `backend/.env.local` (production Supabase — the live project this app deploys to):
```env
SUPABASE_URL=https://zczzviyyrrrmzmvjyigx.supabase.co
SUPABASE_ANON_KEY=sb_publishable_rtTqLL8VnxdSmaIAtHDQrQ_TrMrOwlt
SUPABASE_SERVICE_KEY=<service-role JWT from Supabase dashboard: Settings > API Keys > Legacy (service_role)>
INFERENCE_SERVICE_URL=http://localhost:8000
API_HOST=0.0.0.0
API_PORT=8001
JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long
JWT_ALGORITHM=HS256
```

> **Important:** `SUPABASE_SERVICE_KEY` must be the **legacy `service_role` JWT** (looks like `eyJhbGciOiJIUzI1NiIs...`). The newer `sb_secret_*` keys are **not** valid JWTs and will make GoTrue admin calls (register) fail.

**Frontend** — `frontend-new/.env.local`:
```env
VITE_SUPABASE_URL=https://zczzviyyrrrmzmvjyigx.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_rtTqLL8VnxdSmaIAtHDQrQ_TrMrOwlt
VITE_API_URL=http://localhost:8001
```

> Backend is fixed on **8001**. `VITE_API_URL` must always be `http://localhost:8001`.

### 2b. Run the auth migration

Apply the migration `supabase/migrations/001_clean_reset_and_profiles.sql` via Supabase Studio SQL Editor. This:
- Creates `profiles` table with RLS enabled
- Creates trigger `on_auth_user_created` → `handle_new_user()`: first-ever user → `role=super_admin, status=approved`; all others → `role=clinician, status=pending`
- Creates RLS policies: superadmin full access, admin reads all + edits non-superadmins, users read/update own row

### 2c. Google OAuth setup

1. **Google Cloud Console** → APIs & Services → Credentials → Create OAuth Client ID
   - Application type: Web application
   - Authorized JavaScript origins: `http://localhost:5174`
   - Authorized redirect URIs: `https://zczzviyyrrrmzmvjyigx.supabase.co/auth/v1/callback`
   - Copy Client ID and Client Secret

2. **Supabase Dashboard** → Authentication → Sign In / Providers → Google:
   - Enable Google
   - Paste Client ID and Client Secret
   - Save

3. **Supabase Dashboard** → Authentication → URL Configuration:
   - Site URL: `http://localhost:5174`
   - Redirect URLs: `https://zczzviyyrrrmzmvjyigx.supabase.co/auth/v1/callback`, `http://localhost:5174/**`, `http://localhost:5174/auth/callback`
   - Save

### 2d. Verify superadmin rule

1. Register first account → should be `super_admin` + `approved`, auto-redirects to `/dashboard`
2. Register second account → should be `clinician` + `pending`, shows pending dialog
3. As superadmin, go to `/dashboard/admin`, edit user roles

> **Wrong-role trap:** First-account rule only fires when `profiles` is empty. If already seeded, truncate profiles and create new first user.

---

## Step 3: Set Up the Inference Service (Port 8000)

### 3a. Create venv and install deps

```powershell
cd C:\Users\David\OneDrive\Documents\COUGHPH\packages\inference
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 3b. Check model files

Files `.onnx` should exist in `C:\Users\David\OneDrive\Documents\COUGHPH\models\`:
- `tb_gatekeeper_resnet18.onnx`
- `respiratory_classifier_resnet18.onnx`

If missing, run `python export_onnx.py`.

### 3c. Start inference server

```powershell
# Or via dev.ps1: .\dev.ps1 start
uvicorn inference_service:app --reload --host 0.0.0.0 --port 8000
```

Verify: `http://localhost:8000/health` → `{"status":"healthy","models_loaded":true}`

---

## Step 4: Start Backend + Frontend

> **Use `.\dev.ps1 start` from the repo root instead** — it starts inference + backend + frontend in one command. Manual commands below for reference.

### 4a. Backend

```powershell
cd C:\Users\David\OneDrive\Documents\COUGHPH\backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt

python -m uvicorn main:app --host 0.0.0.0 --port 8001
```

> Backend runs on **8001** (fixed). Do **not** use `--reload` when managed by `dev.ps1`.

### 4b. Frontend

```powershell
cd C:\Users\David\OneDrive\Documents\COUGHPH\frontend-new
npm install
npm run dev
```

App runs at `http://localhost:5174`.

---

## Step 5: Verify Everything

| Check | URL | Expected |
|-------|-----|----------|
| Frontend | `http://localhost:5174` | AURA-Dx homepage loads |
| Backend health | `http://localhost:8001/api/health` | database+auth healthy |
| Swagger docs | `http://localhost:8001/docs` | API endpoints listed |
| Inference health | `http://localhost:8000/health` | `models_loaded: true` |
| Supabase Studio (local) | `http://127.0.0.1:54323` | Studio UI |
| Service status | `.\dev.ps1 status` | All services `[OK]` |

---

## Step 6: Log In

### Existing users
| Email | Role | Status |
|-------|------|--------|
| `rheincama@gmail.com` | super_admin | approved |
| `kohakutouya25@gmail.com` | clinician | approved |
| `desireemaymejes05@gmail.com` | clinician | approved |

### Register new user
1. Go to `http://localhost:5174/register`
2. Fill in details → account created with `status = pending`
3. Admin must approve via `/dashboard/admin` (click green checkmark)

### First-time login flow
Approved clinician logging in first time (no `last_login_at`) sees confirmation dialog. Click "Confirm" → `/dashboard`.

---

## Step 7: Using the App

### As a Clinician
- **Dashboard** → Screening statistics
- **New Screening** → 3-step: patient → record/upload → results
- **Patients** → Add, edit, search all patients
- **Screening Records** → Filter by class/gender, search

### As Admin / Super Admin
- **Users** → Approve/reject/delete, view system metrics
- **Edit roles** → Change clinician ↔ admin (super_admin only)

---

## Troubleshooting

| Symptom | Cause / Fix |
|---------|-------------|
| **Approve button shows "Failed to fetch"** | Backend not running. Start via `.\dev.ps1 start` or manually on port 8001. Check `VITE_API_URL` = `http://localhost:8001`. |
| **"Provider is not enabled" / Google 403** | Google provider off in Supabase, or Client ID/Secret wrong. Re-check Step 2c. |
| **`redirect_uri_mismatch`** | Google redirect URI doesn't match Supabase callback. Confirm exact match: `https://zczzviyyrrrmzmvjyigx.supabase.co/auth/v1/callback` |
| **"Access blocked" on Google login** | App in Testing mode and email not added to Test users. Add it (Step 2c) or publish app. |
| **Register returns generic "failed" error** | Check `backend/register_error.log` for the real error. Common cause: `SUPABASE_SERVICE_KEY` is an `sb_secret_*` key instead of the legacy `service_role` JWT. |
| **No `profiles` row after signup** | Migration didn't run or trigger failed. Re-run Step 2b. |
| **Wrong role (not superadmin)** | `profiles` wasn't empty when first user signed up. Truncate and create new first user. |
| **Missing `audit_logs` table** | Tables should exist from migration. If not, check Supabase SQL Editor for errors during migration. |
| **`GET /api/patients` returns 500 once a patient exists** | `patient_list_view` missing `updated_at`. Re-run `supabase/production_fix1.sql` (recreates both views with `updated_at`). |
| **Patient/screening creation fails for a brand-new user (500, NOT NULL)** | Signup trigger wasn't assigning `clinic_id`, so new profiles had `clinic_id=NULL`. Re-run `supabase/production_fix1.sql` (fixes `handle_new_user()` + backfills). |
| **CORS errors on frontend** | Backend must be running. Check `http://localhost:8001/api/health`. |
| **Port 8000/8001/5174 stuck after a crash** | Run `.\dev.ps1 stop` (or `restart`) — it sweeps and kills orphaned listeners on those ports. |
| **Backend shows healthy but local Supabase is down** | Expected — backend uses **production** Supabase. Local `:54321` is only for DB/migration work. |
| **`dev.ps1 restart` shows Supabase DOWN afterward** | Fixed — `stop` now waits for port 54321 to fully release before starting. If it still happens, ensure Docker Desktop is running before `restart`. |

---

## Environment Files Reference

### `backend/.env.local` (production Supabase)
```
SUPABASE_URL=https://zczzviyyrrrmzmvjyigx.supabase.co
SUPABASE_ANON_KEY=sb_publishable_rtTqLL8VnxdSmaIAtHDQrQ_TrMrOwlt
SUPABASE_SERVICE_KEY=<legacy service_role JWT — must be a JWT, not sb_secret_*>
INFERENCE_SERVICE_URL=http://localhost:8000
API_HOST=0.0.0.0
API_PORT=8001
JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long
JWT_ALGORITHM=HS256
```

### `frontend-new/.env.local` (production Supabase)
```
VITE_SUPABASE_URL=https://zczzviyyrrrmzmvjyigx.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_rtTqLL8VnxdSmaIAtHDQrQ_TrMrOwlt
VITE_API_URL=http://localhost:8001
```

### `frontend-new/.env` (fallback defaults — .env.local overrides)
```
VITE_SUPABASE_URL=https://zczzviyyrrrmzmvjyigx.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_rtTqLL8VnxdSmaIAtHDQrQ_TrMrOwlt
VITE_API_URL=http://localhost:8001
VITE_INFERENCE_URL=http://localhost:8000
```

> If the app is ever switched back to a **local** Supabase instance, replace `SUPABASE_URL` with `http://127.0.0.1:54321` and use the anon/service keys printed by `npx supabase start`.

---

## Project Architecture

```
AURA-Dx/
├── backend/                  # FastAPI backend (Python)
│   ├── main.py               # App entrypoint
│   ├── routes/               # API route handlers (api.py)
│   ├── auth.py               # JWT validation, role checks
│   ├── database.py           # Supabase client
│   ├── models.py             # Pydantic models
│   ├── config.py             # Settings
│   └── .env.local            # Backend config (git-ignored)
├── frontend-new/             # React 19 + Vite 8 + TypeScript
│   ├── src/
│   │   ├── App.tsx           # Routes: public → auth → dashboard
│   │   ├── context/          # AuthContext (OAuth, token exchange)
│   │   ├── hooks/            # useAuth
│   │   ├── lib/              # supabase client
│   │   ├── pages/            # Home, Login, Register, Dashboard, Admin, AuthCallback
│   │   └── components/
│   └── .env.local            # Frontend config (git-ignored)
├── packages/
│   └── inference/            # ML inference service (Python / ONNX)
├── supabase/                 # Supabase config, migrations
├── models/                   # ML model files (.onnx, .pth)
└── SETUP.md                  # This file
```

## Shutting Down

**Easiest:** from the repo root:

```powershell
.\dev.ps1 stop
```

This stops frontend, backend, inference, then shuts down local Supabase (waits for port 54321 to release) and sweeps ports for orphans.

**Manual:**
1. **Frontend:** `Ctrl+C`
2. **Backend:** `Ctrl+C`
3. **Inference:** `Ctrl+C`
4. **Supabase:** `cd supabase && npx supabase stop`

> `supabase stop` keeps data. Use `--no-backup` to discard (re-seed clinic afterward).
