# COUGHPH Design System — Master

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
| `--color-cough-surface` | `#f7fcf9` | Page background |
| `--color-cough-surface-alt` | `#e8f6ef` | Alternate section background |
| `--color-cough-elevated` | `#ffffff` | Card/panel surface |
| `--color-cough-elevated-hover` | `#f2fbf6` | Card hover state |
| `--color-cough-brand` | `#3cb87a` | Primary brand green |
| `--color-cough-brand-soft` | `#d4f0e3` | Soft brand tint |
| `--color-cough-accent` | `#3cb87a` | Interactive accents |
| `--color-cough-accent-dark` | `#2a9a63` | Hover/active states |
| `--color-cough-accent-light` | `#a8e6c8` | Light decorative |
| `--color-cough-accent-soft` | `#d4f0e3` | Background tint |
| `--color-cough-text` | `#1a3c30` | Primary text |
| `--color-cough-muted` | `#5c7a6c` | Secondary/muted text |
| `--color-cough-border` | `#c5e4d4` | Strong borders |
| `--color-cough-border-soft` | `#e0f0e8` | Subtle borders |

## Shadow Scale

| Token | Value | Used For |
|-------|-------|----------|
| `shadow-cough-sm` | `0 2px 8px rgba(42,154,99,0.06)` | Subtle elevation, table rows |
| `shadow-cough-md` | `0 4px 20px rgba(42,154,99,0.08)` | Cards, dialogs |
| `shadow-cough-lg` | `0 12px 32px rgba(42,154,99,0.14)` | Hero, featured sections |

## Type Scale

| Token | Value | Used For |
|-------|-------|----------|
| `text-cough-display` | `2.35rem` (~38px) | Hero headings |
| `text-cough-heading` | `1.55rem` (~25px) | Section titles |
| `text-cough-sub` | `1.125rem` (~18px) | Subtitles |
| `text-cough-body` | `0.9375rem` (15px) | Body text |
| `text-cough-sm` | `0.8125rem` (13px) | Small/labels |
| Base font size: 16px | Line-height: 1.5 body / 1.1 headings |

## Radius Scale

| Token | Value | Used For |
|-------|-------|----------|
| `radius-cough-sm` | `10px` | Buttons, inputs |
| `radius-cough-md` | `16px` | Cards |
| `radius-cough-lg` | `24px` | Hero sections, feature cards |

## Motion

- **Easing:** spring (stiffness: 260, damping: 24) for entries; 200-400ms CSS transitions
- **Stagger:** 60ms default delay between children
- **Exit:** faster than enter (150ms vs 300ms+)
- **Reduced motion:** `prefers-reduced-motion: reduce` resets all animation durations to 0.01ms
- **Library:** Framer Motion (to install in Phase 3)
- **Avoid:** Decorative-only animation, animating width/height, purple/pink gradients

## Anti-Patterns (Do Not Use)

- `bg-gray-50` / `bg-gray-100` — replace with `bg-cough-surface` / `bg-cough-surface-alt`
- `shadow-sm` / `shadow-md` — replace with `shadow-cough-sm` / `shadow-cough-md`
- `border-gray-200` — replace with `border-cough-border-soft`
- Inline SVG icon paths — use lucide-react
- `<details>` native accordion — migrate to controlled component (Phase 2)
- Purple/pink gradients — brand is green
- Native `<table>` — use shadcn `<Table>` component

## Accessibility Baseline

- Focus-visible rings on all interactive elements
- Color contrast WCAG AA (4.5:1 text, 3:1 large text)
- `prefers-reduced-motion` respected
- All icon buttons have `aria-label`
- `cursor-pointer` on clickable elements
