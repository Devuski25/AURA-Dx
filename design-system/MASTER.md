# AURA-Dx Design System — Master

**Generated:** 2026-07-30 via UI/UX Pro Max — Phase 1 (Tokenization)

---

## Product Profile

- **Type:** Medical AI screening / healthcare SaaS
- **Stack:** React 19 SPA + Vite 8.1 + TypeScript 6 + Tailwind v4 + shadcn/ui + lucide-react
- **Style:** Soft UI Evolution — evolved soft UI with better contrast, subtle depth, accessibility-focused
- **Font:** Poppins (Google Fonts) — medical, clean, professional, trustworthy

---

## Color Tokens

All defined in `frontend-new/src/index.css` under `@theme {}`:

| Token | Value | Usage |
|-------|-------|-------|
| `--color-aura-surface` | `#f7fcf9` | Page background |
| `--color-aura-surface-alt` | `#e8f6ef` | Alternate section background |
| `--color-aura-elevated` | `#ffffff` | Card/panel surface |
| `--color-aura-elevated-hover` | `#f2fbf6` | Card hover state |
| `--color-aura-brand` | `#3cb87a` | Primary brand green |
| `--color-aura-brand-soft` | `#d4f0e3` | Soft brand tint |
| `--color-aura-accent` | `#3cb87a` | Interactive accents |
| `--color-aura-accent-dark` | `#2a9a63` | Hover/active states |
| `--color-aura-accent-light` | `#a8e6c8` | Light decorative |
| `--color-aura-accent-soft` | `#d4f0e3` | Background tint |
| `--color-aura-text` | `#1a3c30` | Primary text |
| `--color-aura-muted` | `#5c7a6c` | Secondary/muted text |
| `--color-aura-border` | `#c5e4d4` | Strong borders |
| `--color-aura-border-soft` | `#e0f0e8` | Subtle borders |
| `--color-aura-warning` | `#d97706` | Warning icons/text (amber-600) |
| `--color-aura-warning-strong` | `#b45309` | Warning headings (amber-700) |
| `--color-aura-warning-soft` | `#fef3c7` | Warning backgrounds (amber-100) |
| `--color-aura-warning-border` | `#fde68a` | Warning borders (amber-200) |

## Shadow Scale

| Token | Value | Used For |
|-------|-------|----------|
| `shadow-aura-sm` | `0 2px 8px rgba(42,154,99,0.06)` | Subtle elevation, table rows |
| `shadow-aura-md` | `0 4px 20px rgba(42,154,99,0.08)` | Cards, dialogs |
| `shadow-aura-lg` | `0 12px 32px rgba(42,154,99,0.14)` | Hero, featured sections |

## Type Scale

| Token | Value | Used For |
|-------|-------|----------|
| `text-aura-display` | `2.35rem` (~38px) | Hero headings |
| `text-aura-heading` | `1.55rem` (~25px) | Section titles |
| `text-aura-sub` | `1.125rem` (~18px) | Subtitles |
| `text-aura-body` | `0.9375rem` (15px) | Body text |
| `text-aura-sm` | `0.8125rem` (13px) | Small/labels |
| Base font size: 16px | Line-height: 1.5 body / 1.1 headings |

## Radius Scale

| Token | Value | Used For |
|-------|-------|----------|
| `radius-aura-sm` | `10px` | Buttons, inputs |
| `radius-aura-md` | `16px` | Cards |
| `radius-aura-lg` | `24px` | Hero sections, feature cards |

## Motion

- **Easing:** spring (stiffness: 260, damping: 24) for entries; 200-400ms CSS transitions
- **Stagger:** 60ms default delay between children
- **Exit:** faster than enter (150ms vs 300ms+)
- **Reduced motion:** `prefers-reduced-motion: reduce` resets all animation durations to 0.01ms
- **Library:** Framer Motion
- **Drawer/sidebar:** right-side layout — `lg:` desktop toggle (collapsed ↔ expanded, persisted `aura-dx:sidebar-collapsed`) + right slide-over drawer `<lg` (Escape / backdrop / nav click closes; `inert`+`aria-hidden` while closed)
- **Avoid:** Decorative-only animation, animating width/height, purple/pink gradients

## Anti-Patterns (Do Not Use)

- `bg-gray-50` / `bg-gray-100` — replace with `bg-aura-surface` / `bg-aura-surface-alt`
- `shadow-sm` / `shadow-md` — replace with `shadow-aura-sm` / `shadow-aura-md`
- `border-gray-200` — replace with `border-aura-border-soft`
- Inline SVG icon paths — use lucide-react
- `<details>` native accordion — migrate to controlled component (Phase 2)
- Purple/pink gradients — brand is green
- Native `<table>` — use shadcn `<Table>` component
- Raw hex colors in components — use `aura-*` tokens (exceptions: GoogleIcon.tsx brand colors, CameraCoughDetection.tsx `#3cb87a` theme fallback)

## Accessibility Baseline

- Focus-visible rings on all interactive elements
- Color contrast WCAG AA (4.5:1 text, 3:1 large text)
- `prefers-reduced-motion` respected
- All icon-only buttons ≥44×44px hit area + `aria-label`
- Dialogs use `w-[95vw] max-w-lg` + `max-h-[90vh] overflow-y-auto`
- Tables wrap in `overflow-x-auto`
- `cursor-pointer` on clickable elements

## Mobile Baseline

- Zero horizontal scroll at 375px; keep `overflow-x: clip` on `html, body`
- Tap targets ≥44×44px on touch devices
