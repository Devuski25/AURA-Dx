# edited/ — design drafts, not live code

**Nothing in this folder is compiled, imported, or served.** It exists as a
record of the redesign's working drafts.

## Why it is here

Several components were drafted here before being moved into
`frontend-new/src/` and refined there. Some were dropped entirely. The originals
are kept so the decision trail survives a redesign that rewrote most of the UI.

## What is in here

| File | Status |
|---|---|
| `About.tsx`, `Home.tsx`, `Team.tsx`, `Legal.tsx` | Early drafts of the public pages. Superseded — read `frontend-new/src/pages/public/` for what actually ships. |
| `Carousel.tsx`, `TeamCarousel.tsx`, `RouteCarousel.tsx` | **Dropped.** No carousel shipped. |
| `CountUp.tsx` | **Dropped as a component.** The `useCountUp` hook it wrapped is live and used by Dashboard, ScreeningDetail and ArcGauge. |
| `SmoothScroll.tsx` | **Dropped**, along with the `lenis` dependency. |
| `SectionHeading.tsx`, `SplitHeading.tsx`, `SectionHeading`, `PageHero.tsx`, `PageShell.tsx`, `Reveal.tsx`, `BreathWave.tsx`, `ScrollProgress.tsx`, `ResultSpecimen.tsx` | Drafts. Several shipped and were revised; read the `frontend-new/src/components/` versions. |
| `fine-motion.ts`, `useHeroParallax.ts`, `theme-additions.css` | Drafts of live modules. The live ones are `frontend-new/src/lib/` and `index.css`. |
| `CV-2.pdf` | Unrelated binary, unrelated to the code. |

## A warning about stale content

These drafts predate the v2.5 pipeline, so some of them still describe the old
system — including a TB class and ResNet-18 model names that no longer exist.

**Treat every file here as archaeology.** If you are looking for what the app
does, read `MODEL_CARD.md` and `DESIGN.md` instead of anything in this folder.