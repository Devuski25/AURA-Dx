# COUGHPH — Step-by-Step Setup Guide

**Last updated:** July 2026  
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

### Troubleshooting Supabase

- **"Docker is not running"** → Open Docker Desktop and wait for it to fully start
- **Port conflict** → If port 54321, 54322, or 54323 is already in use, stop the conflicting service or change ports in `supabase/config.toml`
- **Migration failed** → Run `supabase migration up` manually to apply any pending migrations
- **Reset everything** → `supabase db reset` (wipes all data and re-applies migrations)

---

## Step 2: Set Up the Inference Service (Port 8000)

This runs the AI models that analyze cough sounds.

### 2a. Create virtual environment and install dependencies

```powershell
# From project root
cd C:\Users\David\OneDrive\Documents\COUGHPH\packages\inference

# Create a virtual environment (one-time)
python -m venv venv

# Activate it
.\venv\Scripts\Activate.ps1

# Install Python packages
pip install -r requirements.txt
```

**Expected output** (first line should confirm activation):
```
(venv) PS C:\Users\David\OneDrive\Documents\COUGHPH\packages\inference>
```

### 2b. Check that model files exist

```powershell
# List the models directory
Get-ChildItem ..\..\models
```

You should see:
- `tb_gatekeeper_resnet18.onnx`
- `respiratory_classifier_resnet18.onnx`

If you only have `.pth` files instead of `.onnx` files, run the converter:
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
INFO:     TB model loaded, input: input.1
INFO:     Loading Respiratory Classifier from ...\models\respiratory_classifier_resnet18.onnx
INFO:     Respiratory model loaded, input: input.1
INFO:     Started server process [12346]
```

**Verify it's working:**
- Open `http://localhost:8000/health` in your browser
- Expected: `{"status":"healthy","model_version":"1.0.0","models_loaded":true}`

### Troubleshooting Inference

- **"No module named 'onnxruntime'"** → Make sure you activated the venv and ran `pip install -r requirements.txt`
- **Model file not found** → Check that `.onnx` files exist in `C:\Users\David\OneDrive\Documents\COUGHPH\models\`
- **Port 8000 in use** → Change the port (e.g., `--port 8005`) and update `backend\.env` and `frontend-new\.env` to match

---

## Step 3: Start the Backend API (Port 8001)

This is the main backend that handles auth, patient data, and connects to Supabase and the inference service.

### 3a. Create virtual environment and install dependencies

```powershell
# Open a NEW PowerShell terminal (keep the inference one running)
cd C:\Users\David\OneDrive\Documents\COUGHPH\backend

# Create a virtual environment (one-time)
python -m venv venv

# Activate it
.\venv\Scripts\Activate.ps1

# Install Python packages
pip install -r requirements.txt
```

### 3b. Start the backend server

```powershell
# Make sure venv is activated
uvicorn main:app --reload --host 0.0.0.0 --port 8001
```

**Expected output:**
```
INFO:     Uvicorn running on http://0.0.0.0:8001 (Press CTRL+C to quit)
INFO:     Started reloader process [12345]
INFO:     Started server process [12346]
Starting COUGHPH FastAPI Backend...
```

**Verify it's working:**
- Open `http://localhost:8001/docs` in your browser — you should see the Swagger UI with all API endpoints
- Check health: `http://localhost:8001/api/health`

### Troubleshooting Backend

- **"Connection refused" to Supabase** → Make sure `supabase start` is still running in the first terminal
- **Module not found** → Ensure you activated the venv (`.\venv\Scripts\Activate.ps1`) and installed dependencies
- **Port 8001 in use** → Change the port in `backend\.env` (`API_PORT=8005`) and `frontend-new\.env` (`VITE_API_URL=http://localhost:8005`)

---

## Step 4: Start the Frontend (Port 5173)

This is the React web app that you interact with in the browser.

```powershell
# Open a NEW PowerShell terminal
cd C:\Users\David\OneDrive\Documents\COUGHPH\frontend-new

# Install npm dependencies (only needed once, or when packages change)
npm install

# Start the dev server
npm run dev
```

**Expected output:**
```
  VITE v8.1.1  ready in 300ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.x.x:5173/
```

**Open the app:**
- Go to `http://localhost:5173` in your browser
- You should see the COUGHPH login page

---

## Summary: All Services Running

| Service | URL | Port | Terminal Command |
|---------|-----|------|------------------|
| Supabase (DB + Auth) | `http://127.0.0.1:54323` | 54321 (API) | `supabase start` (in `supabase/`) |
| Inference | `http://localhost:8000` | 8000 | `uvicorn inference_service:app --reload --host 0.0.0.0 --port 8000` (in `packages\inference\`) |
| Backend API | `http://localhost:8001` | 8001 | `uvicorn main:app --reload --host 0.0.0.0 --port 8001` (in `backend\`) |
| Frontend | `http://localhost:5173` | 5173 | `npm run dev` (in `frontend-new\`) |

---

## Step 5: Register and Create Your First Admin

### 5a. Register a user

1. Go to `http://localhost:5173/register`
2. Fill in: Full Name, Email, Password
3. Click "Create Account"
4. This creates a user with status = **pending** (no access yet)

### 5b. Make the first user an admin (via database)

Since no admin exists yet to approve users, you need to manually promote the first user:

1. Open Supabase Studio at `http://127.0.0.1:54323`
2. Go to **SQL Editor** (left sidebar)
3. Run this query to find the user ID:

```sql
SELECT id, email, full_name, role, status FROM profiles;
```

4. Then promote the user to admin and approve them:

```sql
UPDATE profiles
SET role = 'admin', status = 'approved'
WHERE email = 'the-email-you-registered-with@example.com';
```

5. Log out and log back in — you now have admin access

### 5c. Approve other users

As an admin, go to **Users** in the sidebar to see pending users. Click the green checkmark to approve them.

---

## Step 6: Using the App

### As a Clinician

1. **Dashboard** — View screening statistics (total screenings, cases by disease)
2. **New Screening** — Select a patient, record/upload a cough audio, get AI analysis results
3. **Patients** — View, add, edit, and search patient records
4. **Screening History** — View past screening results with filtering and sorting

### As an Admin

1. **Dashboard** — View aggregate screening statistics
2. **Patients** — View all patient records (search, filter by disease). **No add/edit/delete**
3. **Users** — Manage user accounts (approve, reject, edit, delete users; view system metrics)

---

## Shutting Down

When you're done, shut down services in reverse order:

```powershell
# Terminal 4 (Frontend): Press Ctrl+C
# Terminal 3 (Backend): Press Ctrl+C
# Terminal 2 (Inference): Press Ctrl+C
# Terminal 1 (Supabase):
cd C:\Users\David\OneDrive\Documents\COUGHPH\supabase
supabase stop
```

> `supabase stop` keeps your database data for next time. Use `supabase stop --no-backup` to discard all data.

---

## Common Issues

### "supabase: command not found"
Install Supabase CLI:
```powershell
npm install -g supabase
# Verify:
supabase --version
```

### Python venv won't activate
If you see a security error about execution policies:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```
Then try activating again.

### "Address already in use" on port 8000/8001
Find what's using the port:
```powershell
netstat -ano | findstr :8000
```
Then kill the process (replace 12345 with the PID from above):
```powershell
taskkill /PID 12345 /F
```

### Frontend shows blank page or CORS errors
Make sure:
- Backend is running on port 8001 (`http://localhost:8001/api/health`)
- Supabase is running (`http://127.0.0.1:54323`)
- The `.env` file in `frontend-new/` has the correct URLs

### "No model versions found" or inference fails
Ensure the ONNX model files exist in `C:\Users\David\OneDrive\Documents\COUGHPH\models\`. If missing, run `python export_onnx.py` from `packages\inference\`.