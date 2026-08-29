# AURA-Dx — Developer Instructions

## Overview

This project has 4 services you need to run locally:

| Service | What It Does | Port |
|---------|-------------|------|
| **Supabase** | Local database, auth, storage | 54321 (API) |
| **Inference** | AI cough analysis models | 8000 |
| **Backend** | FastAPI — auth, patients, screenings | 8001 |
| **Frontend** | React + Vite web app | 5173 |

You need **4 terminal windows** open at the same time.

---

## Prerequisites

Install these tools **before** cloning:

| Tool | Check | Minimum Version |
|------|-------|-----------------|
| Node.js | `node --version` | v18+ |
| npm | `npm --version` | v9+ |
| Python | `python --version` | 3.13+ |
| Docker Desktop | `docker --version` | Any recent (must be running) |
| Supabase CLI | `npm install -g supabase` then `supabase --version` | v2.109+ |

> Docker Desktop **must be running** before starting Supabase. Open Docker Desktop and wait for "Running" in the bottom-left corner.

---

## Step 1: Clone

```powershell
git clone https://github.com/Devuski25/coughph-v2.git
cd coughph-v2
```

---

## Step 2: Create Your Branch

**Never commit to `main`.** Always create a feature branch:

```powershell
git checkout -b feature/your-feature-name
```

Example: `git checkout -b feature/fix-patient-form`

---

## Step 3: Start Supabase

```powershell
cd supabase
npx supabase start
```

**First run** takes 2–5 minutes to download Docker images. After that, you'll see:

```
Started supabase local development setup.

         API URL: http://127.0.0.1:54321
     Studio URL: http://127.0.0.1:54323
   Inbucket URL: http://127.0.0.1:54324  (for email confirmations)
     anon key: eyJhbGciOiJIUzI1NiIs...
service_role key: eyJhbGciOiJIUzI1NiIs...
```

**Keep this terminal open.** Leave Supabase running.

### Verify

Open `http://127.0.0.1:54323` in your browser — you should see Supabase Studio.

---

## Step 4: Create `.env` Files

**Every developer gets different keys** from their own `supabase start`. Copy the `anon key` and `service_role key` from the output above.

### `backend/.env`

Create `backend/.env` with this content (replace the keys with yours):

```env
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=eyJ...   <-- paste your anon key here
SUPABASE_SERVICE_KEY=eyJ... <-- paste your service_role key here
INFERENCE_SERVICE_URL=http://localhost:8000
API_HOST=0.0.0.0
API_PORT=8001
JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long
JWT_ALGORITHM=HS256
```

### `frontend-new/.env`

Create `frontend-new/.env` (the anon key is the same one):

```env
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=eyJ...   <-- paste your anon key here
VITE_API_URL=http://localhost:8001
```

---

## Step 5: Seed the Default Clinic

The app needs a default clinic to create patients. Open Supabase Studio at `http://127.0.0.1:54323`, go to **SQL Editor**, and run:

```sql
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

> Do this every time you run `supabase db reset` or `supabase stop --no-backup`.

---

## Step 6: Start the Inference Service (Port 8000)

Open a **new** PowerShell terminal:

```powershell
cd packages/inference

# Create virtual environment (one-time)
python -m venv venv

# Activate it (every time)
.\venv\Scripts\Activate.ps1

# Install dependencies (one-time)
pip install -r requirements.txt

# Start the server
uvicorn inference_service:app --reload --host 0.0.0.0 --port 8000
```

**Verify:** Open `http://localhost:8000/health` — you should see:

```json
{"status":"healthy","model_version":"1.0.0","models_loaded":true}
```

---

## Step 7: Start the Backend (Port 8001)

Open a **new** PowerShell terminal:

```powershell
cd backend

# Create virtual environment (one-time)
python -m venv venv

# Activate it (every time)
.\venv\Scripts\Activate.ps1

# Install dependencies (one-time)
pip install -r requirements.txt

# Start the server
uvicorn main:app --reload --host 0.0.0.0 --port 8001
```

**Verify:** Open `http://localhost:8001/api/health` — all 3 services should show "healthy".

---

## Step 8: Start the Frontend (Port 5173)

Open a **new** PowerShell terminal:

```powershell
cd frontend-new

# Install dependencies (one-time)
npm install

# Start the dev server
npm run dev
```

**Open:** Go to `http://localhost:5173` in your browser.

---

## Step 9: Verify the Full Stack

1. Open `http://localhost:5173` — you should see the login page
2. Register a new account (clinician role)
3. Log in as the super admin to approve yourself:
   - Contact the project owner for the super admin credentials
   - Or check your Supabase Studio → Authentication → Users to see the seeded accounts
4. After approval, log in as your clinician account
5. Create a patient and run a screening

---

## Coworking Workflow

### Branch Strategy

```
main ──────── stable, production-ready
   │
   └── feature/your-feature ─── your changes
```

**Rules:**
- **Never** commit or push to `main`
- **Always** create a feature branch for your work
- **Always** open a Pull Request (PR) to merge into `main`
- Someone else should review your PR before merging

### Daily Workflow

```powershell
# 1. Make sure you're on main and up to date
git checkout main
git pull origin main

# 2. Create your feature branch
git checkout -b feature/what-youre-working-on

# 3. Make changes, then stage and commit
git add -A
git commit -m "fix: describe what you changed"

# 4. Push your branch to GitHub (first time)
git push -u origin feature/what-youre-working-on

# 5. Later pushes (already tracked)
git push
```

### Opening a Pull Request

1. Go to `https://github.com/Devuski25/coughph-v2`
2. You'll see a banner: "feature/your-feature had recent pushes" — click **Compare & pull request**
3. Write a short description of your changes
4. Click **Create pull request**
5. Wait for review and approval

### After Your PR Is Merged

```powershell
git checkout main
git pull origin main
git branch -d feature/your-feature   # delete local branch
```

---

## How to Add a Coworker as a Collaborator

As the repo owner, you can add teammates so they can push branches and create PRs:

### Via GitHub Website

1. Go to `https://github.com/Devuski25/coughph-v2`
2. Click the **Settings** tab (top of the page)
3. In the left sidebar, click **Collaborators**
4. Click **Add people**
5. Type their GitHub username or email
6. Select their name from the dropdown
7. Click **Add [username] to this repository**
8. They'll receive an email invitation — they must accept it

### Via Command Line

```powershell
gh repo add-collaborator Devuski25/coughph-v2 <their-username>
```

> Replace `<their-username>` with their actual GitHub username.

### Permission Levels

| Role | What They Can Do |
|------|-----------------|
| **Read** | View and clone the repo |
| **Triage** | + Manage issues and PRs |
| **Write** (recommended) | + Push branches, create PRs |
| **Maintain** | + Approve PRs, manage settings |
| **Admin** | Full access including deleting |

For most teammates, give **Write** access — they can push branches and create PRs but can't merge into `main` without approval.

---

## Common Issues

| Issue | Fix |
|-------|-----|
| `supabase: command not found` | `npm install -g supabase` |
| Python venv won't activate | `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser` |
| Port in use | Kill the process: `netstat -ano \| findstr :8000` then `taskkill /PID 12345 /F` |
| Patient creation 500 error | Run the clinic SQL from Step 5 (clinic_id is null) |
| "Email not confirmed" | Check Inbucket at `http://localhost:54324` for confirmation link |
| CORS errors | Backend not running on port 8001? Check `http://localhost:8001/api/health` |
