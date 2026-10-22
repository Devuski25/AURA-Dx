import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { PageHero } from "@/components/PageHero"
import { PageShell } from "@/components/PageShell"
import { SectionHeading } from "@/components/SectionHeading"
import { Stagger, StaggerItem } from "@/components/Reveal"
import { EASE_OUT, VIEWPORT } from "@/lib/fine-motion"
import DesireeImg from "@/assets/public/team/desiree-mejes.webp"
import AhldousImg from "@/assets/public/team/ahldous-argayoso.webp"
import RheinImg from "@/assets/public/team/rhein-cama.webp"
import MichaelImg from "@/assets/public/team/michael-nepomuceno.webp"
import MarkImg from "@/assets/public/team/mark-pesuelo.webp"

/* ── Data ─────────────────────────────────────────────────────────────── */

type Researcher = {
  name: string
  img: string
}

const TEAM: Researcher[] = [
  { name: "Desiree May D. Mejes", img: DesireeImg },
  { name: "Ahldous Meinard C. Argayoso", img: AhldousImg },
  { name: "Rhein David Q. Cama", img: RheinImg },
  { name: "Michael Harvy M. Nepomuceno", img: MichaelImg },
  { name: "Mark Louie A. Pesuelo", img: MarkImg },
]

/** First letter of the first word plus first letter of the last word. */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  const first = parts[0].charAt(0)
  const last = parts[parts.length - 1].charAt(0)
  return (first + last).toUpperCase()
}

/* ── Styles ───────────────────────────────────────────────────────────────
 *
 * Every Tailwind class is written out as a full literal string. Tailwind
 * discovers classes by scanning source text, so any name built with
 * template-string interpolation (`className={active ? `x-${y}` : "z"}`) is
 * never generated in the stylesheet. String concatenation with `+` is fine,
 * because each quoted fragment is still present in the source.
 *
 * Hover styling is gated twice:
 *   - `lg:hover:` keeps the lift, the shadow and the ring on the desktop
 *     breakpoint only. A phone and a tablet are touched, not hovered, and
 *     a tap latches `:hover` onto the last-tapped element, so a "stuck"
 *     raised card is worse than a flat one.
 *   - `motion-safe:` suppresses the transform for prefers-reduced-motion.
 *     Framer's `useReducedMotion()` does not affect plain CSS transitions,
 *     so CSS-driven movement needs its own guard.
 */
const CARD =
  "group relative block w-full cursor-pointer bg-transparent " +
  "transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-forest focus-visible:ring-offset-4"

const SHADOW_IDLE = "shadow-[0_1px_2px_rgba(0,0,0,0.05)]"
const SHADOW_ACTIVE = "shadow-[0_16px_34px_-14px_rgba(0,0,0,0.3)]"

const HOVER_MOTION = "motion-safe:lg:hover:-translate-y-1"
const HOVER_SHADOW =
  "motion-safe:lg:hover:shadow-[0_16px_34px_-16px_rgba(0,0,0,0.24)]"
const HOVER_RING =
  "motion-safe:lg:hover:ring-2 hover-tap:ring-aura-forest"

const RING_IDLE = "ring-1 ring-black/10"
const RING_ACTIVE = "ring-2 ring-aura-forest"

/*
 * Colour behaviour: every portrait sits in its original colour but faded back
 * to 60%, and only the active card — hovered, keyboard-focused or pinned —
 * returns to solid. Fading rather than desaturating keeps each person's actual
 * colour visible at rest, which a `grayscale` filter threw away entirely.
 *
 * Opacity is a colour change rather than motion, so it is not gated behind
 * `motion-safe:`; the duration stays short so it reads as a response. Only the
 * active card lightens, so the grid never has two competing fades to track.
 */
const PORTRAIT_FADED = "opacity-60"
const PORTRAIT_SOLID = "opacity-100"

/** Wrapper that owns the hover zoom, so it never fights the img's own transform. */
const PHOTO_ZOOM =
  "absolute inset-0 " +
  "motion-safe:transition-transform motion-safe:duration-[900ms] motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)] " +
  "motion-safe:lg:group-hover:scale-[1.04]"

/*
 * The label is a sibling of the circle, NOT a child of it. The circle clips its
 * own children with `overflow-hidden rounded-full`, so a pill placed inside would
 * be cut to the narrow bottom arc and shred longer names. Sitting outside the
 * clip, it renders as a full pill over the lower edge of the photo instead.
 */
const NAME_LABEL =
  "pointer-events-none absolute inset-x-3 bottom-3 rounded-full bg-aura-forest " +
  "px-3 py-1.5 text-center text-xs font-semibold leading-snug text-white shadow-aura-md"

/* ── Card ─────────────────────────────────────────────────────────────── */

type PortraitProps = {
  member: Researcher
  /** True while this card is the one showing its name (hover, focus or pinned). */
  active: boolean
  /** True when this card is the pinned one — drives aria-pressed. */
  pinned: boolean
  onHoverStart: (name: string) => void
  onHoverEnd: (name: string) => void
  onFocusStart: (name: string) => void
  onFocusEnd: (name: string) => void
  onToggle: (name: string) => void
}

function Portrait({
  member,
  active,
  pinned: isPinned,
  onHoverStart,
  onHoverEnd,
  onFocusStart,
  onFocusEnd,
  onToggle,
}: PortraitProps) {
  const { name, img } = member
  const [failed, setFailed] = useState(false)
  const reduce = useReducedMotion()
  const imgRef = useRef<HTMLImageElement>(null)

  // onError never fires when the image failed before React attached the
  // handler (cached 404, hydration), so check once on mount as well.
  useEffect(() => {
    const el = imgRef.current
    if (el && el.complete && el.naturalWidth === 0) setFailed(true)
  }, [])

  /* The button owns only the lift and the focus ring. The opacity, shadow and
     hover ring live on the circle below so they hug the photo's edge rather
     than the button's rectangular box — fading the button too would also wash
     out the name label. */
  const buttonClass = `${CARD} ${HOVER_MOTION}`

  return (
    <button
      type="button"
      // The button carries the accessible name, so the visible label below is
      // hidden from screen readers to avoid announcing the name twice.
      aria-label={name}
      aria-pressed={isPinned}
      className={buttonClass}
      onClick={() => onToggle(name)}
      onFocus={() => onFocusStart(name)}
      onBlur={() => onFocusEnd(name)}
      // pointerType is checked so a tap cannot leave a lingering hover state.
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") onHoverStart(name)
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") onHoverEnd(name)
      }}
    >
      {/* The circle owns the aspect ratio. Photo and fallback are both absolutely
          positioned inside it, so neither can change its size. */}
      <div
        className={
          active
            ? `relative aspect-square overflow-hidden rounded-full bg-aura-sage transition-[opacity,box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${SHADOW_ACTIVE} ${RING_ACTIVE} ${HOVER_SHADOW} ${HOVER_RING} ${PORTRAIT_SOLID}`
            : `relative aspect-square overflow-hidden rounded-full bg-aura-sage transition-[opacity,box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${SHADOW_IDLE} ${RING_IDLE} ${HOVER_SHADOW} ${HOVER_RING} ${PORTRAIT_FADED}`
        }
      >
        {failed ? (
          <div className="absolute inset-0 grid place-items-center" aria-hidden="true">
            <span className="grid h-20 w-20 place-items-center rounded-full border border-aura-forest/25 bg-white/60 font-display text-2xl font-bold tracking-wide text-aura-forest">
              {getInitials(name)}
            </span>
          </div>
        ) : (
          <div className={PHOTO_ZOOM}>
            <motion.img
              ref={imgRef}
              src={img}
              alt=""
              className="block h-full w-full object-cover object-top"
              loading="lazy"
              decoding="async"
              onError={() => setFailed(true)}
              initial={reduce ? false : { scale: 1.18 }}
              whileInView={reduce ? undefined : { scale: 1 }}
              viewport={VIEWPORT}
              transition={{ duration: 1.8, ease: EASE_OUT }}
            />
          </div>
        )}
      </div>

      {/* Sits outside the circle's overflow-hidden so the pill stays whole. */}
      <AnimatePresence>
        {active && (
          <motion.span
            key="name-label"
            aria-hidden="true"
            className={NAME_LABEL}
            initial={{ opacity: 0, y: reduce ? 0 : 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduce ? 0 : 10 }}
            transition={{ duration: reduce ? 0 : 0.28, ease: EASE_OUT }}
          >
            {name}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  )
}

/* ── Page ─────────────────────────────────────────────────────────────── */

export function Team() {
  const [pinned, setPinned] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [focused, setFocused] = useState<string | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  // Hover wins while it lasts, so a pinned card yields to the pointer.
  const active = hovered ?? focused ?? pinned

  /* Clear the pinned card on an outside click or tap, and on Escape. */
  useEffect(() => {
    if (!pinned) return

    const onPointerDown = (e: PointerEvent) => {
      if (gridRef.current && !gridRef.current.contains(e.target as Node)) {
        setPinned(null)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPinned(null)
    }

    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [pinned])

  const handleHoverStart = (name: string) => setHovered(name)
  const handleHoverEnd = (name: string) =>
    setHovered((prev) => (prev === name ? null : prev))
  const handleFocusStart = (name: string) => setFocused(name)
  const handleFocusEnd = (name: string) =>
    setFocused((prev) => (prev === name ? null : prev))

  /* Clicking the pinned card again unpins it. */
  const handleToggle = (name: string) =>
    setPinned((prev) => (prev === name ? null : name))

  return (
    <PageShell>
      <PageHero title="Our team" centered>
        AURA-Dx is a BS Computer Engineering thesis project from the University of Rizal System — Morong Campus, built and defended by the researchers below.
      </PageHero>

      <section className="bg-white px-6 py-16 md:py-24">
        <div className="mx-auto max-w-6xl">
          <SectionHeading className="text-center">Researchers</SectionHeading>

          <div ref={gridRef}>
            <Stagger
              as="ul"
              className="mt-12 grid list-none grid-cols-2 gap-6 p-0 sm:grid-cols-3 lg:grid-cols-5"
            >
              {TEAM.map((member) => (
                <StaggerItem as="li" key={member.name} className="m-0">
                  <Portrait
                    member={member}
                    active={active === member.name}
                    pinned={pinned === member.name}
                    onHoverStart={handleHoverStart}
                    onHoverEnd={handleHoverEnd}
                    onFocusStart={handleFocusStart}
                    onFocusEnd={handleFocusEnd}
                    onToggle={handleToggle}
                  />
                </StaggerItem>
              ))}
            </Stagger>
          </div>
        </div>
      </section>
    </PageShell>
  )
}