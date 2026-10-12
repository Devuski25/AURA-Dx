# AURA-Dx — deployment runbook

What to run, in what order, on what machine. Follow it top to bottom.

---

## Which machine does what

| Component | Where | Runs 24/7? |
|---|---|---|
| Frontend (`auradx.xyz`) | Cloudflare, auto-deployed from GitHub | Yes |
| Backend API (`api.auradx.xyz`) | **Your Mini PC**, port 8001 | **No — you control it** |
| Inference (`infer.auradx.xyz`) | **Your Mini PC**, port 8000 | **No — you control it** |
| Database | Supabase project `zczzviyyrrrmzmvjyigx` | Yes |

The frontend is already live. Everything below is the Mini PC and the database.

---

## ⚠️ Order matters

Run these three steps **in this order**. Starting the backend before its
migration produces a 500 on screening creation — not a startup failure, so it
looks like the service started fine and then every screening fails.

---

## Step 1 — database migrations (do this FIRST)

Three new migrations, in order. Supabase Dashboard → SQL Editor, or the
`supabase` MCP server, or `supabase db push`.

| Migration | What it does |
|---|---|
| `20261012000000_multi_recording_fusion_retire_tb.sql` | Adds `recording_paths`, `recording_scores`. Renames TB columns to `*_archived`. Rebuilds the view. |
| `20261013000000_clear_screening_records.sql` | **⚠️ DELETES DATA.** All patients, screenings and audit logs. Keeps every account. |
| `20261013001000_restore_signup_trigger_clinic.sql` | Restores clinic assignment on new signups. Safe, idempotent. |

### About the wipe

Run only `20261013000000` if you actually want the empty slate. It keeps:

- `auth.users` — every login, including Google accounts
- `profiles` — every clinician and admin
- `clinics`
- `email_verification_codes`

It removes: **all patients, all screenings, all audit logs.**

To apply only the schema changes and keep your existing data for now, skip that
one file.

### Also clear the audio files

Uploaded takes live on the Mini PC's disk, not in the database. Delete them or
they accumulate forever:

```powershell
Remove-Item .\backend\uploads_audio\* -Force -ErrorAction SilentlyContinue
```

---

## Step 2 — update and install on the Mini PC

```powershell
cd C:\path\to\AURA-Dx
git pull
```

Then install the inference dependencies. This is the step that changes most —
torch and onnxruntime are gone, TensorFlow and XGBoost are in:

```powershell
cd packages\inference
.\venv\Scripts\Activate
pip install -r requirements.txt
```

Expect this to take a while and to download roughly 600 MB.

If the venv does not exist yet:

```powershell
cd packages\inference
python -m venv venv
.\venv\Scripts\Activate
pip install -r requirements.txt
```

---

## Step 3 — start the services on demand

```powershell
cd C:\path\to\AURA-Dx
.\scripts\aura.ps1 start
```

```
  AURA-Dx service status
  ----------------------
  Inference  RUNNING   http://localhost:8000/health
  Backend    RUNNING   http://localhost:8001/api/health
```

Inference starts first and is health-checked, because the backend calls it on
every screening. If you start them by hand instead, always do inference first.

### When you are done

```powershell
.\scripts\aura.ps1 stop
```

Both go down. Nothing runs overnight.

### Other commands

```powershell
.\scripts\aura.ps1 status     # check without changing anything
.\scripts\aura.ps1 restart    # stop then start
```

Logs and PID files: `%LOCALAPPDATA%\AURA-Dx\`

---

## Step 4 — the frontend

Already done. Pushing to `main` auto-deploys to Cloudflare; there is nothing to
run and nothing to re-trigger.

The frontend dev server is separate and optional:

```powershell
cd frontend-new
npm run dev     # http://localhost:5174
```

---

## Checking it works

```powershell
# Both should report healthy
curl http://localhost:8000/health
curl http://localhost:8001/api/health
```

Then in the browser, with the dev mock bypassed:

```
VITE_DISABLE_API_MOCK=true
```

in `frontend-new/.env.local`, otherwise the dev build answers `/api/` from
fixtures and the recording flow cannot be tested at all.

A full pass: log in → Dashboard is empty → create a patient → record 3 takes →
analyse → Screening Detail shows the per-take table → download the PDF.

---

## If something fails

| Symptom | Cause |
|---|---|
| `422` on audio upload | Backend is still the old code. `git pull` and restart. |
| `500` on screening creation | Migration 1 not applied yet. |
| `502` on screening creation | Backend up, inference down. Start inference. |
| Screening works, no per-take table | Migration 1 not applied, so `recording_scores` is NULL. |
| `dev-mock has no route` | Mock is installed. Set `VITE_DISABLE_API_MOCK=true`. |
| New signup cannot create a patient | Migration 3 not applied. |
| Port already in use | Something else is on 8000/8001, or a previous run is still alive. `aura.ps1 stop` falls back to killing whatever owns the port. |

---

## Rotating the exposed credentials

`SERVICE_CONFIGURATION.md` holds a Supabase `service_role` key, a Resend API key
and the JWT secret in plaintext. It is gitignored and was never committed, but
it has sat unencrypted on disk. **Rotate all three**, then update
`backend/.env.local` on the Mini PC and restart.