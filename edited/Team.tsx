import { useEffect, useRef, useState } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { PageHero } from "@/components/PageHero"
import { PageShell } from "@/components/PageShell"
import { SectionHeading } from "@/components/SectionHeading"
import { Stagger, StaggerItem } from "@/components/Reveal"
import { EASE_OUT, VIEWPORT } from "@/lib/fine-motion"
import DesireeImg from "@/assets/public/team/desiree-mejes.jpg"
import AhldousImg from "@/assets/public/team/ahldous-argayoso.jpg"
import RheinImg from "@/assets/public/team/rhein-cama.jpg"
import MichaelImg from "@/assets/public/team/michael-nepomuceno.jpg"
import MarkImg from "@/assets/public/team/mark-pesuelo.jpg"

/* ── Data ─────────────────────────────────────────────────────────────── */

const COURSE = "Bachelor of Science in Computer Engineering"
const SCHOOL = "University of Rizal System — Morong Campus"

type Researcher = {
  name: string
  img: string
  /** Optional line under the name, e.g. "Machine learning". */
  role?: string
  /** Only set these when a member differs from the shared defaults. */
  course?: string
  school?: string
}

const TEAM: Researcher[] = [
  { name: "Desiree May D. Mejes", img: DesireeImg },
  { name: "Ahldous Meinard C. Argayoso", img: AhldousImg },
  { name: "Rhein David Cama", img: RheinImg },
  { name: "Michael Harvy Nepomuceno", img: MichaelImg },
  { name: "Mark Louie Pesuelo", img: MarkImg },
]

/** First letter of the first and last word: "Mark Louie Pesuelo" → "MP". */
function getInitials(name: string) {
  const parts = name.trim().split(/\s+/)
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/* ── Styles ───────────────────────────────────────────────────────────── */
/*
 * Every Tailwind class below is written out in full on purpose. Tailwind finds
 * classes by scanning source text, so names built with template strings or
 * interpolation (e.g. `motion-safe:${EASE}`) are never generated.
 *
 * Hover effects are gated twice:
 *  - `hover:hover` media query → no "stuck" hover state after a tap on touch screens
 *  - `motion-safe:` on anything that moves → respects prefers-reduced-motion
 *    (framer's useReducedMotion doesn't affect plain CSS transitions)
 */
const CARD =
  "group m-0 h-full rounded-[1.25rem] border border-black/5 bg-white p-3 " +
  "shadow-[0_1px_2px_rgba(0,0,0,0.04)] " +
  "transition-[transform,box-shadow,background-color,border-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] " +
  "[@media(hover:hover)]:hover:border-aura-forest/15 " +
  "[@media(hover:hover)]:hover:bg-aura-sage/20 " +
  "[@media(hover:hover)]:hover:shadow-[0_14px_32px_-14px_rgba(0,0,0,0.22)] " +
  "motion-safe:[@media(hover:hover)]:hover:-translate-y-1"

const IMAGE_ZOOM =
  "absolute inset-0 " +
  "motion-safe:transition-transform motion-safe:duration-[900ms] motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)] " +
  "motion-safe:[@media(hover:hover)]:group-hover:scale-[1.04]"

/* ── Card ─────────────────────────────────────────────────────────────── */

function Portrait({ member }: { member: Researcher }) {
  const { name, img, role, course = COURSE, school = SCHOOL } = member
  const [failed, setFailed] = useState(false)
  const reduce = useReducedMotion()
  const imgRef = useRef<HTMLImageElement>(null)

  // onError never fires if the image failed before React attached the handler
  // (cached 404, hydration). Check once on mount to catch that case.
  useEffect(() => {
    const el = imgRef.current
    if (el && el.complete && el.naturalWidth === 0) setFailed(true)
  }, [])

  return (
    <figure className={CARD}>
      {/* The frame owns the 4:5 ratio. Both states are absolutely positioned
          inside it, so the image and the fallback can never change its size. */}
      <div className="relative aspect-[4/5] overflow-hidden rounded-lg bg-aura-sage after:pointer-events-none after:absolute after:inset-0 after:rounded-lg after:ring-1 after:ring-inset after:ring-black/10">
        {failed ? (
          <div className="absolute inset-0 grid place-items-center" aria-hidden="true">
            <span className="grid h-20 w-20 place-items-center rounded-full border border-aura-forest/25 bg-white/60 font-display text-2xl font-bold tracking-wide text-aura-forest">
              {getInitials(name)}
            </span>
          </div>
        ) : (
          <div className={IMAGE_ZOOM}>
            <motion.img
              ref={imgRef}
              src={img}
              // Decorative: the caption already names the person.
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

      {/* Hierarchy: name (strong) → role/course (muted) → school (quietest). */}
      <figcaption className="px-1 pb-1 pt-4">
        <p className="text-[0.95rem] font-semibold leading-snug tracking-tight text-aura-text">{name}</p>
        {role && <p className="mt-1 text-sm font-medium leading-snug text-aura-forest">{role}</p>}
        <p className="mt-1.5 text-[0.8125rem] leading-snug text-aura-muted">{course}</p>
        <p className="mt-0.5 text-xs leading-snug text-aura-muted/75">{school}</p>
      </figcaption>
    </figure>
  )
}

/* ── Page ─────────────────────────────────────────────────────────────── */

export function Team() {
  return (
    <PageShell>
      <PageHero title="Our team">
        AURA-Dx is a BS Computer Engineering thesis project from the University of Rizal System — Morong Campus, built and defended by the researchers below.
      </PageHero>

      <section className="bg-white px-6 py-16 md:py-24">
        <div className="mx-auto max-w-6xl">
          <SectionHeading>Researchers</SectionHeading>
          {/* Grid items stretch to equal height; a short last row sits flush left. */}
          <Stagger
            as="ul"
            className="mt-12 grid list-none grid-cols-1 gap-6 p-0 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5"
          >
            {TEAM.map((member) => (
              <StaggerItem as="li" key={member.name}>
                <Portrait member={member} />
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>
    </PageShell>
  )
}
