# COUGHPH — Step-by-Step Setup Guide

**Last updated:** July 30, 2026  
**OS:** Windows (PowerShell)

---

## Prerequisites Check

Before starting, make sure you have these installed:

| Tool | Check Command | Required Version |
|------|---------------|------------------|
| Node.js | `node --version` | v18+ |
| npm | `npm --version` | v9+ |
| Python | `python --version` | 3.13+ |
| Docker Desktop | `docker --version` | Any recent version |
| Supabase CLI | `supabase --version` | v2.109.1+ |

> **Docker Desktop must be running** before you start Supabase. Open Docker Desktop and wait until it shows "Running" in the bottom-left corner.

---

## Step 1: Start Supabase (Local Database + Auth)

This runs PostgreSQL, the Auth API, and Supabase Studio all in Docker containers.

```powershell
# Open PowerShell and navigate to the project root
cd C:\Users\David\OneDrive\Documents\COUGHPH

# Go to the supabase directory
cd supabase

# Start Supabase (first run takes 2-5 minutes to download images)
npx supabase start
```

**Expected output** (yours will have different keys):
```
Started supabase local development setup.

         API URL: http://127.0.0.1:54321
          DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
      Studio URL: http://127.0.0.1:54323
    Inbucket URL: http://127.0.0.1:54324
      anon key: eyJhbGciOiJIUzI1NiIs...
service_role key: eyJhbGciOiJIUzI1NiIs...
```

**Verify it's working:**
- Open `http://127.0.0.1:54323` in your browser — you should see Supabase Studio
- Check status: `supabase status`

> **NOTE:** The migration files in `supabase/migrations/` apply automatically on first start. They create all tables (profiles, patients, screenings, clinics, audit_logs), indexes, RLS policies, and views.

### 1a. Seed default clinic and assign clinic_id to users

COUGHPH runs as a **single-clinic deployment** — all clinicians, patients, and screenings belong to one clinic. Run these SQL commands in Supabase Studio SQL Editor (`http://127.0.0.1:54323/project/default/sql/new`) after every `supabase db reset` or `supabase stop --no-backup`:

```sql
-- Insert default clinic (skip if already exists)
INSERT INTO clinics (id, name, address, phone, email, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Default Clinic',
  '123 Main St, City',
  '+1234567890',
  'clinic@coughph.local',
  true
) ON CONFLICT (id) DO NOTHING;

-- Assign all users without a clinic to the default clinic
UPDATE profiles
SET clinic_id = '00000000-0000-0000-0000-000000000001'
WHERE clinic_id IS NULL;
```

> **Note:** In this single-clinic setup, all doctors can see **all patients** and **all screening records** — there is no per-doctor scoping. Patient creation still records `clinician_id` for audit purposes, but it does not restrict access.

---

## Step 2: Set Up the Inference Service (Port 8000)

This runs the AI models that analyze cough sounds.

### 2a. Activate virtual environment and install dependencies

```powershell
cd C:\Users\David\OneDrive\Documents\COUGHPH\packages\inference

# Create a virtual environment (one-time only)
python -m venv venv

# Activate it (do this every time)
.\venv\Scripts\Activate.ps1

# Install Python packages (one-time, or when requirements change)
pip install -r requirements.txt
```

**Expected output** (first line should confirm activation):
```
(venv) PS C:\Users\David\OneDrive\Documents\COUGHPH\packages\inference>
```

### 2b. Check that model files exist

```powershell
Get-ChildItem ..\..\models
```

You should see both `.pth` and `.onnx` files:
- `tb_gatekeeper_resnet18.onnx` ✅
- `respiratory_classifier_resnet18.onnx` ✅
- `tb_gatekeeper_resnet18.pth`
- `respiratory_classifier_resnet18.pth`

If `.onnx` files are missing, convert from PyTorch:
```powershell
python export_onnx.py
```

### 2c. Start the inference server

```powershell
# Make sure venv is still activated (you should see "(venv)" in the prompt)
uvicorn inference_service:app --reload --host 0.0.0.0 --port 8000
```

**Expected output:**
```
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
INFO:     Started reloader process [12345]
INFO:     Loading TB Gatekeeper from ...\models\tb_gatekeeper_resnet18.onnx
INFO:     TB model loaded, input: input
INFO:     Loading Respiratory Classifier from ...\models\respiratory_classifier_resnet18.onnx
INFO:     Respiratory model loaded, input: input
INFO:     Application startup complete.
```

**Verify it's working:**
- Open `http://localhost:8000/health` in your browser
- Expected: `{"status":"healthy","model_version":"1.0.0","models_loaded":true}`

### Troubleshooting Inference

- **"No module named 'onnxruntime'"** → Make sure you activated the venv and ran `pip install -r requirements.txt`
- **Model file not found** → Check that `.onnx` files exist in `C:\Users\David\OneDrive\Documents\COUGHPH\models\`
- **Port 8000 in use** → Change the port (e.g., `--port 8005`) and update `backend\.env` + `frontend-new\.env`

---

## Step 3: Unified Dev Command (Backend + Frontend)

Now start **both the backend API and frontend dev server** from a single command.

### 3a. Set up the backend Python environment (one-time)

```powershell
cd C:\Users\David\OneDrive\Documents\COUGHPH\backend

# Create a virtual environment (one-time only)
python -m venv venv

# Activate it
.\venv\Scripts\Activate.ps1

# Install Python packages (one-time, or when requirements change)
pip install -r requirements.txt
```

### 3b. Install root Node dependencies (one-time)

```powershell
cd C:\Users\David\OneDrive\Documents\COUGHPH
npm install
```

### 3c. Start both services with one command

```powershell
cd C:\Users\David\OneDrive\Documents\COUGHPH
npm run dev
```

**Expected output:**
```
[backend]  INFO:     Uvicorn running on http://0.0.0.0:8001 (Press CTRL+C to quit)
[frontend] 
[frontend]   VITE v8.x.x  ready in 300ms
[frontend] 
[frontend]   ➜  Local:   http://localhost:5173/
```

> The `npm run dev` command uses `concurrently` to run both:
> - **Backend** (cyan): `uvicorn main:app --reload --port 8001` on port 8001
> - **Frontend** (green): `vite --port 5173` on port 5173

### 3d. Verify everything

| Check | URL | Expected Result |
|-------|-----|----------------|
| Frontend app | `http://localhost:5173` | COUGHPH website homepage loads first (not login) |
| Backend API health | `http://localhost:8001/api/health` | `{"status":"healthy","services":{"database":"healthy","inference":"healthy","auth":"healthy"}}` |
| Swagger docs | `http://localhost:8001/docs` | All API endpoints listed |
| Inference health | `http://localhost:8000/health` | `{"status":"healthy","models_loaded":true}` |

---

## Step 4: Open the App

Open `http://localhost:5173` in your browser. You should see the **COUGHPH public website** — not the login page.

### Public Website Pages (no login required)

| Page | URL | Content |
|------|-----|---------|
| **Home** | `/` | Hero section, How the System Works (2-tier pipeline), Built for Clinic, FAQ accordion, consent notice |
| **About** | `/about` | Two-tier gated pipeline explanation, interactive four-class tag selector (Healthy/COPD/Pneumonia/TB), signal processing table, hardware specs |
| **Our Team** | `/team` | 5 team member cards with photos, scroll-reveal animation |
| **Legal & Privacy** | `/legal` | R.A. 10173 / R.A. 10175 governing law, consent, data subject rights table, thesis-stage disclosure |

Navigation bar at the top links between all pages. Click **Login** in the nav bar to reach the login form.

> The app loads the **public website first**. Only when you click "Login" does it take you to the authenticated portal. Refresh always returns to the website homepage.

---

## Step 5: Log In

### Existing Users (pre-seeded in profiles)

| Email | Role | Status |
|-------|------|--------|
| `rheincama@gmail.com` | super_admin | approved |
| `kohakutouya25@gmail.com` | clinician | approved |
| `elmar@gmail.com` | clinician | approved |
| `harvy@gmail.com` | clinician | approved |

**Passwords:** Ask the project owner — they were set during account creation in Supabase.

### Register a New User

1. Go to `http://localhost:5173/register`
2. Fill in: Full Name, Email, Password
3. Click "Create Account" — user is created with `status = pending`
4. An admin must approve you:
   - Log in as `rheincama@gmail.com` (super_admin)
   - Go to **Users** in sidebar
   - Click the green checkmark to approve

### First-Time Login Flow

When an approved clinician logs in for the first time (no prior `last_login_at`), they see a confirmation dialog. Click "Confirm" to proceed.

---

## Step 6: Using the App

### As a Clinician

| Page | How to Get There | What You Can Do |
|------|------------------|-----------------|
| **Dashboard** | Sidebar → Dashboard | View screening statistics (all doctors' screenings) |
| **New Screening** | Sidebar → New Screening | 3-step flow: select/create patient → record/upload cough → view AI results |
| **Patients** | Sidebar → Patients | View **all** patients (not just your own), add, edit, search |
| **Screening Records** | Sidebar → Screening Records | View **all** screening records, filter by class/gender, search |

> **Single-clinic behavior:** All clinicians see all patients and all screening records. The `clinician_id` is recorded for audit purposes only.

### As an Admin / Super Admin

| Page | How to Get There | What You Can Do |
|------|------------------|-----------------|
| **Dashboard** | Sidebar → Dashboard | View aggregate screening stats |
| **Patients** | Sidebar → Patients | View all patient records (search, filter by disease) |
| **Users** | Sidebar → Users | Approve/reject/delete users, view system metrics |

### Running a Screening (Full Flow)

1. Click **New Screening** in sidebar
2. **Step 1**: Select an existing patient OR click "New Patient Screening" to create one
   - Fill in name, DOB (age auto-calculates), gender, smoking, diseases, symptoms
   - Click **Create Patient & Continue**
3. **Step 2**: Record cough audio (mic button) or upload a `.wav` file
   - Click **Run Analysis** (takes 10-30 seconds)
4. **Step 3**: View results — TB classification, respiratory classification, confidence bars, clinical recommendations
   - Click **New Screening** to start over or **View Dashboard** to go back

---

## Summary: All Services Running

| Service | URL | Port | Terminal Command |
|---------|-----|------|------------------|
| Supabase (DB + Auth) | `http://127.0.0.1:54323` | 54321 (API) | `npx supabase start` (from `supabase/`) |
| Inference | `http://localhost:8000` | 8000 | `uvicorn inference_service:app --reload --host 0.0.0.0 --port 8000` (from `packages\inference\`, venv active) |
| Backend API | `http://localhost:8001` | 8001 | Runs via `npm run dev` from root |
| Frontend | `http://localhost:5173` | 5173 | Runs via `npm run dev` from root |

**You need 3 terminals total:**
1. **Terminal 1:** Supabase (`cd supabase && npx supabase start`)
2. **Terminal 2:** Inference (`cd packages\inference && .\venv\Scripts\Activate.ps1 && uvicorn inference_service:app --reload --host 0.0.0.0 --port 8000`)
3. **Terminal 3:** Unified backend + frontend (`cd <root> && npm run dev`)

> Previously this required 4 terminals. The root `npm run dev` command now runs both backend and frontend concurrently.

---

## Project Architecture

```
COUGHPH/
├── backend/                  # FastAPI backend (Python)
│   ├── main.py               # App entrypoint
│   ├── routers/              # API route handlers
│   ├── services/             # Business logic
│   └── .env                  # Backend config
├── frontend-new/             # All frontend code (React 19 + Vite 8 + TypeScript 6)
│   ├── src/
│   │   ├── App.tsx           # Routes: public pages → auth → dashboard
│   │   ├── components/
│   │   │   ├── public/       # PublicLayout.tsx (nav + footer for website pages)
│   │   │   └── layout/       # Authenticated Layout.tsx (sidebar + header)
│   │   ├── pages/
│   │   │   ├── public/       # Home.tsx, About.tsx, Team.tsx, Legal.tsx
│   │   │   ├── Login.tsx     # Login form
│   │   │   ├── Register.tsx  # Registration form
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Screening.tsx
│   │   │   ├── Screenings.tsx
│   │   │   ├── Patients.tsx
│   │   │   └── Admin.tsx
│   │   ├── assets/public/    # Website images (hero, team photos, etc.)
│   │   └── index.css         # Tailwind v4 + green theme tokens + Poppins font
│   └── .env                  # Frontend config
├── packages/
│   └── inference/            # ML inference service (Python / ONNX)
├── supabase/                 # Supabase config, migrations, seed
├── models/                   # ML model files (.onnx, .pth)
├── package.json              # Root scripts: dev, dev:backend, dev:frontend
└── SETUP.md                  # This file
```

### Routing Structure

Routes are defined in `frontend-new/src/App.tsx`:

| Route | Layout | Component | Auth Required |
|-------|--------|-----------|---------------|
| `/` | PublicLayout | Home | No |
| `/about` | PublicLayout | About | No |
| `/team` | PublicLayout | Team | No |
| `/legal` | PublicLayout | Legal | No |
| `/login` | — | Login | No (redirects to dashboard if already logged in) |
| `/register` | — | Register | No (redirects to dashboard if already logged in) |
| `/dashboard` | Layout (auth) | Dashboard | Yes |
| `/dashboard/screening` | Layout (auth) | Screening | Yes |
| `/dashboard/screenings` | Layout (auth) | Screenings | Yes |
| `/dashboard/patients` | Layout (auth) | Patients | Yes |
| `/dashboard/admin` | Layout (auth, admin only) | Admin | Yes (admin/super_admin) |
| `*` (any other) | — | Redirect to `/` | No |

---

## Shutting Down

Shut down in reverse order:

```powershell
# Terminal 3 (Unified dev): Press Ctrl+C
# Terminal 2 (Inference): Press Ctrl+C
# Terminal 1 (Supabase):
cd C:\Users\David\OneDrive\Documents\COUGHPH\supabase
supabase stop
```

> `supabase stop` keeps data. Use `supabase stop --no-backup` to discard all data (you'll need to re-seed the clinic from Step 1a next time).

---

## Common Issues & Fixes

### `supabase: command not found`
```powershell
npm install -g supabase
supabase --version
```

### Python venv won't activate (security error)
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### "Address already in use" on port 8000/8001
```powershell
netstat -ano | findstr :8000
taskkill /PID 12345 /F   # replace 12345 with the PID
```

### Patient creation returns 500 error
**Root cause:** `clinic_id` is NULL in user profiles.
**Fix:** Run the SQL from Step 1a to seed the default clinic and assign profiles.

### Frontend shows blank page or CORS errors
- Backend running on port 8001? Check `http://localhost:8001/api/health`
- Supabase running? Check `http://127.0.0.1:54323`
- `.env` file in `frontend-new/` has the correct URLs? (`VITE_API_URL=http://localhost:8001`)

### "No model versions found" or inference fails
Ensure `.onnx` files exist in `C:\Users\David\OneDrive\Documents\COUGHPH\models\`. If missing, run `python export_onnx.py` from `packages\inference\`.

### Inference service won't start
Check that the venv is activated: `.\venv\Scripts\Activate.ps1` then try again. Verify deps: `pip list | findstr onnxruntime`

### "Create Patient & Continue" button does nothing
If you see no toast or error, the auth session may be stale. Log out and log back in. If the button was already working, check the browser console for errors.

### Website pages not loading (shows login page instead)
Make sure you're running the latest version of `frontend-new/`. The app should load the public website at `/`. If it redirects to `/login`, check that `App.tsx` has the public routes defined before auth routes (routes should include `<PublicLayout>` with Home, About, Team, Legal).

---

## Environment Files Reference

### `backend\.env`
```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...
INFERENCE_SERVICE_URL=http://localhost:8000
API_HOST=0.0.0.0
API_PORT=8001
JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long
JWT_ALGORITHM=HS256
```

### `frontend-new\.env`
```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_API_URL=http://localhost:8001
VITE_INFERENCE_URL=http://localhost:8000
```

> The Supabase keys in these files must match what `npx supabase start` prints. They change every time you reset.
