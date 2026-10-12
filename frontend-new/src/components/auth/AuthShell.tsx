import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { motion, useReducedMotion } from "framer-motion"
import { ArrowLeft } from "lucide-react"
import { Logo } from "@/components/layout/Logo"
import { authCardVariants } from "@/components/auth/auth-motion"

/* Card geometry. Two variants, because the two forms have very different
   amounts to hold:

   - Login has two short rows and suits an even 50/50 split in a 4xl card.
   - Register has eight fields. An even split leaves its form only ~368px wide,
     which is too narrow to pair anything two-up — so `wideForm` pins the brand
     column to 20rem instead, leaving ~496px for the form. That is enough for a
     240px pair (enough for a phone number or licence number) while still
     leaving full-width room for names and specialisations.

   Both cards are capped at `max-w-4xl` so neither page is wider than the other.

   Every class is a full literal; Tailwind needs to see each one. */

const CARD_BASE =
  "relative grid w-full grid-cols-1 overflow-hidden rounded-2xl border border-aura-border bg-white shadow-aura-xl"

const CARD_NARROW = CARD_BASE + " max-w-4xl md:grid-cols-2"
const CARD_WIDE = CARD_BASE + " max-w-4xl md:grid-cols-[20rem_1fr]"

/* Register has more vertical content, so it gets tighter padding than Login —
   `py-7` against `py-10`. Together with the field grid's `gap-3` and the
   6px label offset inside `AuthField`, that is what keeps a ten-row form
   inside a card that still reads as landscape rather than a tall panel.

   `justify-center` keeps the form optically centred in the white column. The
   brand panel sets a 560px floor from `md` up, and Login's form is much
   shorter than that — without this the fields hang off the top of the card and
   the column reads as empty below them. Safe here because the grid row always
   grows to fit whichever column is taller, so the content can never overflow
   the box that `justify-center` centres it within. */
const PANEL_NARROW = "flex flex-col justify-center bg-white px-6 py-10 sm:px-8 md:px-10"
const PANEL_WIDE = "flex flex-col justify-center bg-white px-6 py-7 sm:px-8 md:px-10"

type AuthShellProps = {
  /**
   * Brand column content — the headline and tagline. The wordmark and the
   * gradient live here so Login and Register cannot drift apart.
   */
  brand: ReactNode
  /** Form column content. */
  children: ReactNode
  /** Wider card with an asymmetric split, for forms with many fields. */
  wideForm?: boolean
}

/**
 * The frame both auth pages share: mint gradient backdrop, back arrow, and the
 * split card — dark brand column on the left, white form column on the right.
 *
 * The brand column collapses to a short banner below `md`, where the wordmark
 * and headline sit above the tagline.
 */
export function AuthShell({ brand, children, wideForm = false }: AuthShellProps) {
  const reduced = useReducedMotion() ?? false

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_center,#9edfc1_0%,#b5e7d0_40%,#dcf2e8_74%,#effaf4_100%)] px-4 py-10 sm:py-12">
      <motion.div
        variants={authCardVariants}
        initial={reduced ? false : "hidden"}
        animate="visible"
        className={wideForm ? CARD_WIDE : CARD_NARROW}
      >
        <aside className="relative isolate flex min-h-[160px] flex-col overflow-hidden bg-gradient-to-br from-aura-forest via-aura-forest-light to-aura-pine md:min-h-[560px]">
          {/* Back arrow, anchored to the top-left of the brand panel.

              On mobile the panel is a short banner and the wordmark sits
              directly under the button, so the content carries `pt-[4.5rem]`
              to clear it. From `md` up the panel is tall with its content
              vertically centred, which leaves the top-left corner empty —
              there the button just floats. */}
          <Link
            to="/"
            aria-label="Back to Website"
            title="Back to Website"
            className="absolute left-5 top-4 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-white/70 bg-white text-aura-forest shadow-aura-lg transition-all duration-200 hover:-translate-y-px hover:bg-aura-mint-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-aura-forest md:left-8 md:top-8"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>

          <div className="relative z-10 flex flex-1 flex-col justify-center gap-2 px-6 pb-6 pt-[4.5rem] md:px-10 md:py-12">
            <Logo inverse size="lg" />
            {brand}
          </div>
        </aside>

        <div className={wideForm ? PANEL_WIDE : PANEL_NARROW}>{children}</div>
      </motion.div>
    </div>
  )
}