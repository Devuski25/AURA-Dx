# AURA-Dx — Agent Guide

## What

AI cough screening web app. Analyzes cough audio for **TB, COPD, Pneumonia, Healthy** using a two-stage cascade (ResNet-18 → ONNX).

```
Supabase :54321 → Inference :8000 → Backend :8001 → Frontend :5174
 PostgreSQL       ONNX Runtime       FastAPI           React 19 + Vite
 Auth + RLS       librosa + scipy    JWT + roles       Tailwind v4 + shadcn
```

| Service | Entry | Stack |
|---------|-------|-------|
| Inference | `packages/inference/inference_service.py` | FastAPI, ONNX Runtime, librosa |
| Backend | `backend/main.py` | FastAPI, supabase-py, python-jose, ReportLab |
| Frontend | `frontend-new/src/App.tsx` | React 19, Vite 8, TS 6, Tailwind v4, shadcn/ui |
| Database | `supabase/config.toml` | PostgreSQL 17, GoTrue Auth, RLS |

## How

### Start

**Recommended:** `.\dev.ps1 start` (brings up Supabase → Inference → Backend → Frontend in order).

Manual, one service at a time:

```bash
# 1. Supabase (Docker must be running). NOTE: `npx supabase start` HANGS on
#    the npx install/version prompt — use the cached CLI binary or dev.ps1:
#    $SUPABASE_BIN = Get-ChildItem "$env:LOCALAPPDATA\npm-cache\_npx\*\node_modules\@supabase\cli-windows-x64\bin\supabase.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
#    & $SUPABASE_BIN start   # first run may need a retry (storage healthcheck race)

# 2. Inference
cd packages/inference && .\venv\Scripts\Activate && uvicorn inference_service:app --reload --port 8000

# 3. Backend
cd backend && .\venv\Scripts\Activate && uvicorn main:app --reload --port 8001

# 4. Frontend
cd frontend-new && npm run dev
```

### Verify

| Check | Command |
|-------|---------|
| Frontend lint | `cd frontend-new && npm run lint` |
| Frontend build | `cd frontend-new && npm run build` |
| Frontend E2E | `python test_e2e.py` (dev server on :5174 required) |
| Backend import | `cd backend && python -c "from main import app"` |
| Inference import | `cd packages/inference && python -c "from inference_service import app"` |
| Backend health | `curl http://localhost:8001/api/health` |
| Inference health | `curl http://localhost:8000/health` |

### Testing

- **Browser/UI verification must use the chrome-devtools MCP server** (tools: `chrome_devtools_navigate_page`, `chrome_devtools_click`, `chrome_devtools_fill`, `chrome_devtools_screenshot`, `chrome_devtools_take_snapshot`). When asked to verify any frontend/UI behavior, always drive the real browser via chrome-devtools — do not assert UI works from code reading alone, and do not use Playwright/`test_e2e.py` for UI checks (that script is backend-only/secondary).
- Frontend dev server runs on `:5174`; it calls the backend on `:8002` (dev port workaround — not `:8001`).

### Key paths

- **API endpoints**: `backend/routes/api.py` (all routes in one file)
- **Auth logic**: `backend/auth.py` (JWT decode, role gating)
- **DB schema**: `supabase/migrations/` (9 files, run in order)
- **ML pipeline**: `packages/inference/inference_service.py:68-95` (preprocessing)
- **Design tokens**: `frontend-new/src/index.css` + `design-system/MASTER.md`

### MCP Servers

Configured in `.opencode/opencode.json` (OpenCode auto-loads this; no manual `claude mcp add` needed).

| Server | Command / Transport | Purpose |
|--------|---------------------|---------|
| `supabase` | `npx -y @supabase/mcp-server-supabase` (env `SUPABASE_ACCESS_TOKEN`, project `zczzviyyrrrmzmvjyigx`) | Inspect/query the hosted Supabase project, run SQL, manage migrations via the MCP client. |
| `motion-dev` | `node dist/index.js` (cwd `C:/Users/David/motion-dev-mcp`) | Motion Dev MCP. Source built locally at `C:/Users/David/motion-dev-mcp` (clone → `npm install` → `npm run build`). Rebuild if its source changes. |

Notes:
- `animate-ui` and `shadcn-ui/ui` are **component libraries, NOT MCP servers** — add their components via the shadcn CLI / registry, not as MCP servers.
- Browser/UI verification uses the `chrome-devtools` MCP server (see Testing above).

## DO NOT

### Never touch
- `models/*.onnx` and `models/*.pth` — no retraining, no modifications
- Dead code: `backend/app.py`, `backend/audio_utils.py` — only when explicitly instructed AND a real fix is needed
- `coughph-website/` — legacy static site, fully replaced

### Ask first
- `supabase/config.toml` ports — other services depend on them; only change when instructed
- `supabase/migrations/` — schema changes require confirmation
- New npm packages — project is 50%+ done, no new dependencies without approval
- Inference preprocessing params — MODEL_CARD.md is the source of truth

### Enforce
- **Preprocessing**: `N_MELS=64, n_fft=1024, hop_length=256, TB_SLICE=0.45s, RESP_SLICE=2.0s`
- **Single-clinic model**: all clinicians see all patients (no per-doctor scoping)
- **First-user rule**: first注册 user → `super_admin`, all others → `clinician` + `pending`
- **No commits to main** — always `feature/*` branches
- **Port consistency**: Inference `:8000`, Backend `:8001`, Frontend `:5174`, Supabase `:54321`
- **Branding**: AURA-Dx (Acoustic Unit for Respiratory Analysis), green `#3cb87a`. No `cough`-era naming in new UI.
- **A11y**: all icon-only buttons ≥44×44px hit area + `aria-label`; dialogs use `w-[95vw] max-w-lg` + `max-h-[90vh] overflow-y-auto`; tables wrap in `overflow-x-auto`
- **Layout**: left-side sidebar — `lg:` desktop toggle (collapsed ↔ expanded, persisted `aura-dx:sidebar-collapsed`) + left slide-over drawer `<lg` (Escape / backdrop / nav click closes; `inert`+`aria-hidden` while closed)
- **Mobile-first**: zero horizontal scroll on 375px; keep `overflow-x: clip` on `html, body`

### Avoid
- Redux/Zustand — use React Context only
- Native `<table>` — use shadcn `<Table>`
- Gray Tailwind tokens (`bg-gray-*`) — use aura-surface tokens
- Purple/pink gradients — brand is green (`#3cb87a`)
- Inline SVG — use `lucide-react`
- Raw hex colors in components — use `aura-*` tokens (exceptions: GoogleIcon.tsx brand colors, CameraCoughDetection.tsx `#3cb87a` theme fallback)
