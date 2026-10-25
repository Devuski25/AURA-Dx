# AURA-Dx — Agent Guide

## What

AI cough screening web app. Analyzes stethoscope recordings for **COPD, Pneumonia, Healthy** using a two-stage cascade (XGBoost → EfficientNetB0) fused across 3–5 separate takes.

```
Supabase :54321 → Inference :8000 → Backend :8001 → Frontend :5174
 PostgreSQL       XGBoost + TF      FastAPI           React 19 + Vite
 Auth + RLS       librosa + scipy    JWT + roles       Tailwind v4 + shadcn
```

| Service | Entry | Stack |
|---------|-------|-------|
| Inference | `packages/inference/inference_service.py` | FastAPI, XGBoost, TensorFlow/Keras, librosa |
| Backend | `backend/main.py` | FastAPI, supabase-py, python-jose, ReportLab |
| Frontend | `frontend-new/src/App.tsx` | React 19, Vite 8, TS 6, Tailwind v4, shadcn/ui |
| Database | `supabase/config.toml` | PostgreSQL 17, GoTrue Auth, RLS |

## How

### Start

Start each service in its own terminal, in this order:

```bash
# 1. Supabase (Docker must be running). NOTE: `npx supabase start` HANGS on
#    the npx install/version prompt — use the cached CLI binary:
#    $SUPABASE_BIN = Get-ChildItem "$env:LOCALAPPDATA\npm-cache\_npx\*\node_modules\@supabase\cli-windows-x64\bin\supabase.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
#    & $SUPABASE_BIN start   # first run may need a retry (storage healthcheck race)

# 2. Inference
cd packages/inference && .\venv\Scripts\Activate && uvicorn inference_service:app --reload --port 8000

# 3. Backend
cd backend && .\venv\Scripts\Activate && uvicorn main:app --reload --port 8001

# 4. Frontend
cd frontend-new && npm run dev
```

> Production/Mini PC: the backend + inference services are started and health-checked
> by the deployment scripts on that machine (`start-aura-services.ps1`,
> `verify-aura.ps1`). They live on the Mini PC only and are deliberately not
> tracked in this repo.

### Verify

| Check | Command |
|-------|---------|
| Frontend lint | `cd frontend-new && npm run lint` |
| Frontend build | `cd frontend-new && npm run build` |
| Backend import | `cd backend && python -c "from main import app"` |
| Inference import | `cd packages/inference && python -c "from inference_service import app"` |
| Backend health | `curl http://localhost:8001/api/health` |
| Inference health | `curl http://localhost:8000/health` |
| Fusion decision table | `python packages/inference/test_fusion.py` |
| Feature layout contract | `python packages/inference/test_feature_layout.py` |
| Batched Stage 2 gives the same verdict | `python packages/inference/test_batched_scoring.py` |
| Service script regression | `powershell -ExecutionPolicy Bypass -File scripts/test-aura-start.ps1` |
| Migration safety checks | `python scripts/check-migrations.py` |
| Frontend↔backend API contract | `python scripts/audit-api-contract.py` |
| Orphaned pages / route sanity | `python scripts/audit-routes.py` |
| Unreferenced files | `python scripts/find-unused.py` |
| Responsive contract | `python scripts/check-responsive.py` |
| Table column alignment | `python scripts/check-table-alignment.py` |
| Patient picker header matches its rows | `python scripts/check-picker-grid.py` |
| Selected-site card matches the dropdown | `node frontend-new/scripts/check-site-card.mjs` |
| Route prefetching fetches the right chunk | `node frontend-new/scripts/check-route-prefetch.mjs` |
| Every hover is split for a touch screen | `node frontend-new/scripts/check-hover-split.mjs` |
| Every text colour clears WCAG AA | `node frontend-new/scripts/check-contrast.mjs` |
| How long each API call takes | `python backend/test_api_timing.py` |
| Environment gating (fail-closed) | `python backend/test_app_env.py` |
| CORS LAN scoping | `python backend/test_cors_lan.py` |
| PDF report styles (no clipped type) | `python backend/test_pdf_styles.py` |
| PDF report consistency (heading vs advice) | `python backend/test_pdf_consistency.py` |
| Classification agrees with the probabilities | `python backend/test_classification.py` |
| Patient ownership and the delete paths | `python backend/test_patient_ownership.py` |
| Every filter narrows the list correctly | `python backend/test_filters.py` |
| No response is built from a list of rows | `python backend/test_row_unpacking.py` |
| No endpoint returns a 500 | `python backend/test_endpoint_sweep.py` |
| The API stays responsive during an analysis | `python backend/test_analysis_responsiveness.py` |
| 10-20 concurrent users get no 429s and no blocked loop (`--inference` also proves the cascade gives identical verdicts under load) | `python backend/test_concurrency.py` |
| Remove the recordings no screening refers to | `python backend/cleanup_audio.py` |
| Live stack status | `.\deploy\mini-pc\start-aura-services.ps1 status` |
| Real preprocessing (needs working librosa) | `python packages/inference/test_preprocessing.py` |

`test_fusion.py` and `test_feature_layout.py` need only numpy — they stub
FastAPI/Pydantic/librosa, so they are safe on any machine. Run them after any
change to thresholds, fusion order, or the Stage 1/2 preprocessing.

### Testing

- **Browser/UI verification must use the chrome-devtools MCP server** (tools: `chrome_devtools_navigate_page`, `chrome_devtools_click`, `chrome_devtools_fill`, `chrome_devtools_screenshot`, `chrome_devtools_take_snapshot`). When asked to verify any frontend/UI behavior, always drive the real browser via chrome-devtools — do not assert UI works from code reading alone, and do not use Playwright for UI checks.
- Frontend dev server runs on `:5174`; it calls the backend on `:8002` (dev port workaround — not `:8001`).

### Key paths

- **API endpoints**: `backend/routes/api.py` (all routes in one file)
- **Auth logic**: `backend/auth.py` (JWT decode, role gating)
- **DB schema**: `supabase/migrations/` (13 files, run in order)
- **ML pipeline**: `packages/inference/inference_service.py` — `segment_features` (Stage 1, 51-d per cycle), `build_stage1_features` (153-d aggregation), `build_stage2_tensor` (log-mel), `fuse_clips` (cross-recording)
- **Training reference**: `final icbhi nb.ipynb` — the source of truth for every preprocessing constant
- **Design tokens**: `frontend-new/src/index.css` + `design-system/MASTER.md`

### MCP Servers

Configured in `.opencode/opencode.json` (OpenCode auto-loads this; no manual `claude mcp add` needed).

| Server | Command / Transport | Purpose |
|--------|---------------------|---------|
| `chrome-devtools` | `chrome-devtools-mcp` (local, stdio) | **Browser/UI verification.** Installed via `npm i -g chrome-devtools-mcp`. Requires Chrome at the standard install path. |
| `supabase` | `npx -y @supabase/mcp-server-supabase` (env `SUPABASE_ACCESS_TOKEN`, project `zczzviyyrrrmzmvjyigx`) | Inspect/query the hosted Supabase project, run SQL, manage migrations via the MCP client. |
| `motion-dev` | `node dist/index.js` (cwd `C:/Users/David/motion-dev-mcp`) | Motion Dev MCP. Source built locally at `C:/Users/David/motion-dev-mcp` (clone → `npm install` → `npm run build`). Rebuild if its source changes. |

Notes:
- Servers live under `mcp.servers.<name>` in **OpenCode V2**. A server
  placed directly under `mcp` is the V1 shape and is silently ignored — the file
  parses as valid JSON and `opencode mcp list` reports nothing configured.
- There is no `enabled` field. Use `disabled: true` to keep a server configured
  without connecting it.
- `animate-ui` and `shadcn-ui/ui` are **component libraries, NOT MCP servers** — add their components via the shadcn CLI / registry, not as MCP servers.
- MCP tools are loaded when a session starts. Fixing the config mid-session
  requires a restart before the tools appear; `opencode mcp list` confirms
  connection status independently of that.

## DO NOT

### Never touch
- `model_1_5_export/` and `model_2_5_export/` — no retraining, no modifications. These are the live models.
- Dead code: `backend/app.py`, `backend/audio_utils.py` — only when explicitly instructed AND a real fix is needed
- `coughph-website/` — legacy static site, fully replaced

> The old `models/` directory (ResNet-18 `.pth`/`.onnx`, TB gatekeeper) was deleted
> on 2026-10-12 — it is unreferenced by the current pipeline.

### Ask first
- `supabase/config.toml` ports — other services depend on them; only change when instructed
- `supabase/migrations/` — schema changes require confirmation
- New npm packages — project is 50%+ done, no new dependencies without approval
- Inference preprocessing params — MODEL_CARD.md is the source of truth

### Enforce
- **Preprocessing**: `sr=16000, bandpass 100–2000 Hz (Butterworth 4th, filtfilt), peak-normalise, N_MELS=64, n_fft=1024, hop_length=256`
- **Per-take routing**: Stage 1 XGBoost `p_healthy >= 0.61` → Healthy, skips Stage 2. Otherwise Stage 2 EfficientNetB0, `p_pneumonia >= 0.47` → Pneumonia else COPD (`p_copd = 1 - p_pneumonia`)
- **Fusion**: mean across the 3–5 takes, then safety override — any single take at `>= 0.60` pneumonia confidence wins regardless of the mean
- **Preprocessing source of truth**: `final icbhi nb.ipynb`. Both stages' constants come from it verbatim. Do not tidy them into librosa defaults — Stage 1 uses default n_fft=2048/hop=512, Stage 2 uses 1024/256, and that difference is real.
- **Patient ownership**: a patient belongs to the clinician who created it — only that clinician sees and edits it. Admins see every patient in their clinic; the super_admin sees all. This mirrors the RLS policies on `patients` (`patients_own`, `patients_clinic_admin`, `patients_admin_all`), which the backend used to bypass because it queries with the service-role key.
- **Repeated screening**: a patient may be screened as many times as clinically needed. Every screening carries its sequence number for that patient and the patient's total, computed in `screening_history_view` with a window function.
- **First-user rule**: first注册 user → `super_admin`, all others → `clinician` + `pending`
- **No commits to main** — always `feature/*` branches
- **Port consistency**: Inference `:8000`, Backend `:8001`, Frontend `:5174`, Supabase `:54321`
- **Branding**: AURA-Dx (Acoustic Unit for Respiratory Assessment), green `#3cb87a`. No `cough`-era naming in new UI.

### The domain is `auradx.xyz`. The product is `AURA-Dx`.

Two different things that look identical and are not. Getting this wrong is not
cosmetic -- `api.aura-dx.xyz` does not resolve.

| | Spelling | Where |
|---|---|---|
| Product / brand | `AURA-Dx` (hyphenated) | UI copy, PDF reports, page titles, email subjects, `agents.md` headings |
| Domain | `auradx.xyz` (no hyphen) | `auradx.xyz`, `www.auradx.xyz`, `api.auradx.xyz`, `infer.auradx.xyz` |
| Internal identifiers | `aura-dx` | npm `package.json` name, Cloudflare worker name, `localStorage` keys, PDF filenames |

`scripts/audit-routes.py` fails on a hyphenated canonical, and
`frontend-new/.env.example` pins the API host. Neither catches a stray
`aura-dx.xyz` inside prose, so check by eye when writing config.
- **A11y**: all icon-only buttons ≥44×44px hit area + `aria-label`; dialogs use `w-[95vw] max-w-lg` + `max-h-[90vh] overflow-y-auto`; tables wrap in `overflow-x-auto`
- **Layout**: left-side sidebar — `lg:` desktop toggle (collapsed ↔ expanded, persisted `aura-dx:sidebar-collapsed`) + left slide-over drawer `<lg` (Escape / backdrop / nav click closes; `inert`+`aria-hidden` while closed)
- **Mobile-first**: zero horizontal scroll on 375px; keep `overflow-x: clip` on `html, body`

### Responsive contract

Three targets, treated as genuinely different devices rather than one layout
that stretches.

| Target | Width | Layout | Chrome |
|---|---|---|---|
| Phone | <=639px | 1 column | drawer nav, safe-area padding |
| Tablet | 640-1023px | 2 columns | drawer nav |
| Desktop | >=1024px | 3-5 columns | persistent sidebar |
| Large | >=1536px | same grid, root font 18px; >=1920px 19px | - |

Rules that are not optional:

- **375px must not scroll horizontally.** `overflow-x: clip` on `html, body` is
  the backstop, not the mechanism.
- **A wide table goes inside `overflow-x-auto`, never a bare `min-w-[...]px`.** A
  min-w wider than 340px is only correct when an overflow ancestor exists.
- **Multi-column grids need a responsive escape.** `grid-cols-2` with no
  `sm:`/`md:`/`lg:` override is a bug, not a style choice.
- **Icon-only buttons >=44x44px.** Add `touch-target` or an explicit `h-11`+.
- **Full-bleed mobile chrome reads `env(safe-area-inset-*)`** - exposed as
  `--aura-safe-top|right|bottom|left` on `html, body`. Without it, content hides
  under a notch or a gesture bar.
- **`prefers-reduced-motion` is honoured at the CSS layer**, not only inside
  Framer Motion.

Verify with `python scripts/check-responsive.py`. It reads class strings, so it
catches what is written - it cannot prove a layout renders correctly. A real
device still has to check it.


### Avoid
- Redux/Zustand — use React Context only
- Native `<table>` — use shadcn `<Table>`
- Gray Tailwind tokens (`bg-gray-*`) — use aura-surface tokens
- Purple/pink gradients — brand is green (`#3cb87a`)
- Inline SVG — use `lucide-react`
- Raw hex colors in components — use `aura-*` tokens (exception: GoogleIcon.tsx brand colors)
