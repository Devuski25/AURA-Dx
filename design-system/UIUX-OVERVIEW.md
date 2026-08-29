# AURA-Dx — UI/UX & Architecture Overview

**Generated:** 2026-08-18 · Codebase scan of `frontend-new/` (React 19 + Vite)

---

## 1. Tech Stack & Frameworks

| Layer | Choice |
|-------|--------|
| Framework | **React 19.2** SPA, **Vite 8.1**, TypeScript 6, `react-router-dom` v7 |
| UI framework | **Tailwind CSS v4** (CSS-first `@theme` tokens) + **shadcn/ui** (Radix primitives) |
| Radix primitives | Avatar, Dialog, DropdownMenu, Label, ScrollArea, Select, Separator, Slot, Tabs, Toast |
| Forms | `react-hook-form` + `zod` + `@hookform/resolvers` (shadcn Form wrapper) |
| State management | **React Context only** (single `AuthContext`/`useAuth`) — no Redux/Zustand per project rule |
| Icons | `lucide-react` (one exception: `GoogleIcon` + inline SVGs on public pages — violation) |
| Animation | **framer-motion** v12 (`@/lib/motion` variants) |
| Notifications | `sonner` Toaster |
| Backend | FastAPI (JWT + roles), Supabase (Postgres/GoTrue), ONNX inference service |
| Camera ML | `@mediapipe/tasks-vision` (face-mesh cough detection) |

Routing is **code-split** via `React.lazy` → separate chunks; `ErrorBoundary` + `Suspense` + skip-link + `ScrollToTop` are wired globally in `App.tsx`.

## 2. Directory Structure & Key Pages

```
frontend-new/src/
├─ App.tsx                 # Routes + PrivateRoute + lazy pages + ErrorBoundary
├─ main.tsx, index.css
├─ context/AuthContext.tsx # the ONLY state provider
├─ hooks/useAuth.ts
├─ lib/  api.ts, supabase.ts, motion.ts, utils.ts, badge-helpers.tsx
├─ components/
│  ├─ ui/                  # 17 shadcn components (button, card, dialog, table…)
│  ├─ layout/Layout.tsx    # App shell: sidebar + topbar + <Outlet>
│  ├─ public/PublicLayout.tsx
│  ├─ NewPatientModal.tsx, CameraCoughDetection.tsx, GoogleIcon.tsx
└─ pages/
   ├─ public/  Home, About, Team, Legal     (marketing site)
   ├─ Login, Register, ResetPassword, AuthCallback
   ├─ Dashboard, Screening (3-step wizard), Screenings, ScreeningDetail
   ├─ Patients, PatientDetail, Admin
```

**Routes:** `/` (Home) · `/about` `/team` `/legal` · `/login` `/register` `/reset-password` `/auth/callback` · protected `/dashboard` tree: index, `screening`, `screenings`, `patients`, `patients/:id`, `screenings/:id`, `admin` (role-gated admin/super_admin). Unknown → `/`. `PrivateRoute` gates by auth + `status==="approved"` + optional role array.

**Data-access pattern is split:** Dashboard/Screenings/ScreeningDetail/Screening/Admin/NewPatientModal use `fetch` + backend JWT (`getApiUrl`); **Patients.tsx reads and PatientDetail.tsx deletes go direct to the supabase client** — inconsistent.

## 3. Design System & Styling Setup

**Tokens** (defined in `src/index.css` `@theme{}`, documented in `design-system/MASTER.md`):

- **Colors:** `aura-surface` `#f7fcf9`, `aura-surface-alt` `#e8f6ef`, `aura-elevated` `#fff`, `aura-brand`/`aura-accent` `#3cb87a`, `accent-dark` `#2a9a63`, `accent-soft` `#d4f0e3`, `text` `#1a3c30`, `muted` `#5c7a6c`, `border`/`border-soft` `#c5e4d4`/`#e0f0e8`. Green brand only.
- **Shadows:** `shadow-aura-sm/md/lg` (green-tinted).
- **Type:** `text-aura-display/heading/sub/body/sm`; font **Poppins** (Google Fonts import).
- **Radius:** `radius-aura-sm/md/lg` (10/16/24px).
- **Dark mode:** `.dark` block **exists** (shadcn neutral palette) but **effectively disabled** — `Layout.tsx:47` does `document.documentElement.classList.remove("dark")` on every mount. No toggle, default neutral palette conflicts with green brand.
- **Shared UI:** 17 shadcn components. **Anti-pattern rules** (AGENTS.md/MASTER.md): no `bg-gray-*`, no `shadow-sm/md` raw, no native `<table>` (use shadcn `<Table>`), no inline SVG, no purple/pink, no Redux.

## 4. Current Animation/Motion Setup

- **Library:** framer-motion v12. Central variant library `src/lib/motion.ts`: `spring` presets, `pageVariants`, `cardHover`, `staggerContainer`/`staggerItem`, `fadeUp`, `scaleIn`, `sidebarVariants`.
- **Used:** public pages (Home/About/Team), Dashboard (stagger/cardHover), Screening wizard (`AnimatePresence mode="wait"` + `scaleIn` per step), app shell (page transitions on `pathname`), sidebar/topbar `whileTap` buttons.
- **Not used (inconsistent):** Patients, PatientDetail, Screenings, ScreeningDetail, Admin — **zero motion**; these are the workhorse tables, so page transitions are inconsistent across the app.
- **Not actually leveraged:** `prefers-reduced-motion` global rule in `index.css` (0.01ms) is present and correct.
- No GSAP. No CSS `animate-*` beyond Tailwind's `animate-spin`.

## 5. Key UX Gaps / Architectural Weaknesses

### Critical

1. **Screening review workflow is unreachable (dead feature).** `ScreeningDetail.tsx` defines `reviewDialogOpen`/`handleReview` + a read-only Review Status card, but **no button opens the dialog** — `pending_review` screenings can't be actioned anywhere, despite being a first-class state on Dashboard + badges.
2. **Camera aura-detection shows placeholder as real data.** `CameraCoughDetection.tsx:57` hardcodes `AUDIO_CONFIDENCE_PLACEHOLDER = 0.85` (documented TODO), yet Screening surfaces "Cough Detected" chips/panels as real results. Also a **developer debug panel renders in production** (L683-693: `d={0.013} thr={0.012}`, fps/ms, `>>> OPEN`, `text-lime-300`), plus `window.__coughDebug` and `console.log`s.
3. **Duplicated surface area with divergent schemas:** screening detail exists as both a dialog (`Screenings.tsx`) and a page (`ScreeningDetail.tsx`, ~90% identical); patient-create exists as both `NewPatientModal` (pill checkboxes, no `pack_years`) and Patients.tsx's inline form (comma-separated text, has `pack_years`). Badge logic re-implemented in Dashboard/PatientDetail/Screening instead of shared `lib/badge-helpers.tsx`.

### Consistency & correctness

4. **Silent errors masquerade as empty states:** Patients.tsx and Screenings.tsx `console.error` a failed fetch, then render "No patients/screenings found."; PatientDetail + ScreeningDetail **silently redirect** on fetch error; Screenings PDF download swallows non-OK responses. Only Dashboard has the inline-error+retry pattern.
5. **Extensive hardcoded Tailwind palette vs tokens:** `text-green-600`, `yellow-600/700`, `amber-*`, `border-l-red-500`, **`border-l-purple-500`/`text-purple-600` (Dashboard, breaks brand rule)**, off-brand **blue** Tier-2 cards, Admin's inline `hsl(...)` strings, raw `#3cb87a` in camera component, `#5ecf98`/`#1f7a4f` gradients in PublicLayout.
6. **Content discrepancy:** `About.tsx` claims TB window `0.34s`; AGENTS.md/MODEL_CARD enforce `TB_SLICE=0.45s`.
7. **File-format mismatch:** drop zone accepts mp3/flac/ogg/m4a but `<input accept=".wav">` restricts the picker to WAV.
8. **Convention violations:** inline `<svg>` in Home/About; native `<table>` in About/Legal; unused `--font-family-primary` token while `font-[Poppins,sans-serif]` arbitrary value used in PublicLayout; hamburger is a single bar with no close state; `shadow-[0_12px_40px...]` arbitrary shadow.
9. **Button "Add Patient" on Dashboard navigates to the list instead of opening a create dialog** (misleading affordance); stat cards not clickable.

### Loading / a11y

10. **Spinner misuse:** Dashboard's Refresh/Retry replaces the whole page with a spinner; Screening's *active* step indicator renders a spinning `Loader2` (implies loading, not "current"); Admin metrics tab isn't `loading`-guarded (stale zeros) and re-fetch flickers the users table to a spinner on every subscription change.
11. **Missing `role="status"`** on most `Loader2` spinners (Dashboard is the only correct one); icon-only edit/delete buttons lack `aria-label` in Patients/Admin (Screenings uses `title`).
12. **Tables:** all scroll in `overflow-x-auto overflow-y-auto max-h-[…]` with **no sticky headers**; Screenings sortable `<th>`s are mouse-only `<div>`s (no keyboard, no `aria-sort`); delete-confirm buttons lack disabled/pending state (double-click risk).
13. **Contrast:** `text-aura-muted/80` and the `text-[0.65rem]` lime debug panel fall below AA.

### Dead code / cruft

14. Unused state `uploadProgress` (Screening), unreachable review state, unused `index` prop (Team), and ~15 unused imports (`CardFooter`, `Separator`, `Filter`, `TableFooter`, `cn` in Admin, `DialogTrigger`, 7 lucide icons in ScreeningDetail). `Card`/`CardTitle` shadcn defaults are overridden in nearly every usage — tokens could be promoted into the components.

### Strengths worth keeping

Role-based nav, strong toast usage for mutations, solid OTP/registration flow, global ErrorBoundary + lazy code-splitting, consistent green token architecture, and a well-structured `lib/motion.ts` variant system.