import { useState } from "react"
import { Link, Outlet, useLocation } from "react-router-dom"
import { AnimatePresence, motion, useScroll, useSpring } from "framer-motion"
import { pageVariants, spring } from "@/lib/motion"
import { Logo } from "@/components/layout/Logo"
import { ArrowUpRight } from "lucide-react"

const NAV_ITEMS = [
  { label: "Home", path: "/" },
  { label: "About System", path: "/about" },
  { label: "Our Team", path: "/team" },
  { label: "Legal & Privacy", path: "/legal" },
]

function ScrollProgress() {
  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, { stiffness: 140, damping: 28, mass: 0.4 })
  return (
    <motion.div
      aria-hidden="true"
      style={{ scaleX }}
      className="fixed inset-x-0 top-0 z-[70] h-[3px] origin-left bg-gradient-to-r from-aura-mint via-aura-accent to-aura-forest-light"
    />
  )
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation()
  return (
    <ul className="m-0 flex list-none flex-col gap-1 lg:flex-row lg:gap-0">
      {NAV_ITEMS.map((item) => (
        <li key={item.path}>
          <Link
            to={item.path}
            onClick={onNavigate}
            className={`block rounded-lg px-4 py-2.5 text-sm font-semibold no-underline transition-all duration-200 ${
              pathname === item.path
                ? "bg-aura-forest text-white shadow-sm shadow-aura-forest/20"
                : "text-aura-text/70 hover:bg-aura-bg-alt hover:text-aura-text"
            }`}
          >
            {item.label}
          </Link>
        </li>
      ))}
    </ul>
  )
}

export function PublicLayout() {
  const [navOpen, setNavOpen] = useState(false)

  return (
    <div className="min-h-screen bg-aura-bg font-[Poppins,sans-serif] text-aura-text">
      <ScrollProgress />

      {/* ─── Main header ─── */}
      <header className="sticky top-0 z-50 border-b border-aura-border-soft/40 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3">
          <Link
            to="/"
            aria-label="AURA-Dx — Acoustic Unit for Respiratory Analysis"
            className="flex shrink-0 items-center text-aura-text no-underline"
          >
            <Logo size="lg" />
          </Link>

          {/* Mobile hamburger */}
          <motion.button
            whileTap={{ scale: 0.88 }}
            transition={{ type: "spring", stiffness: 500, damping: 20 }}
            className="relative z-50 flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border border-aura-border bg-white lg:hidden"
            onClick={() => setNavOpen(!navOpen)}
            aria-label="Toggle navigation"
            aria-expanded={navOpen}
          >
            <span aria-hidden="true" className="relative block h-4 w-5">
              <motion.span
                animate={navOpen ? { y: 7, rotate: 45 } : { y: 0, rotate: 0 }}
                transition={spring.snappy}
                className="absolute left-0 top-0 block h-0.5 w-5 rounded bg-aura-text"
              />
              <motion.span
                animate={navOpen ? { y: -7, rotate: -45 } : { y: 0, rotate: 0 }}
                transition={spring.snappy}
                className="absolute bottom-0 left-0 block h-0.5 w-5 rounded bg-aura-text"
              />
            </span>
          </motion.button>

          {/* Desktop nav */}
          <nav className="hidden lg:block">
            <NavLinks />
          </nav>

          {/* Mobile dropdown */}
          <AnimatePresence>
            {navOpen && (
              <motion.nav
                key="mobile-nav"
                initial={{ opacity: 0, y: -10, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.97 }}
                transition={spring.gentle}
                style={{ transformOrigin: "top right" }}
                className="absolute inset-x-4 top-[60px] z-50 flex flex-col items-stretch gap-1 rounded-2xl border border-aura-border-soft bg-white p-3 shadow-aura-lg lg:hidden"
              >
                <NavLinks onNavigate={() => setNavOpen(false)} />
              </motion.nav>
            )}
          </AnimatePresence>

          {/* CTA button */}
          <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }} transition={{ type: "spring", stiffness: 400, damping: 17 }}>
            <Link
              to="/login"
              className="block shrink-0 rounded-full bg-aura-forest px-6 py-2.5 text-sm font-bold text-white no-underline shadow-lg shadow-aura-forest/25 transition-all duration-200 hover:bg-green-700 hover:shadow-xl"
            >
              Login
            </Link>
          </motion.div>
        </div>
      </header>

      <AnimatePresence mode="wait">
        <motion.main
          key={useLocation().pathname}
          variants={pageVariants}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          <Outlet />
        </motion.main>
      </AnimatePresence>

      {/* ─── Footer ─── */}
      <footer className="bg-aura-forest px-6 pb-8 pt-14 text-white">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-12 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
            {/* Brand column */}
            <div>
              <Logo size="md" inverse withSubtitle />
              <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/60">
                Web-based AI system for early detection of respiratory diseases via cough sound analysis.
              </p>
              <div className="mt-4 flex items-center gap-1.5 rounded-full bg-white/8 px-3 py-1.5 text-[0.65rem] font-semibold tracking-wide text-white/50 uppercase">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-aura-accent" />
                Thesis-stage research prototype
              </div>
            </div>

            {/* Quick Links */}
            <div>
              <h4 className="mb-4 text-xs font-bold uppercase tracking-widest text-white/35">Quick Links</h4>
              <nav aria-label="Footer quick links">
                <ul className="m-0 flex list-none flex-col gap-3 p-0">
                  {NAV_ITEMS.map((item) => (
                    <li key={item.path}>
                      <Link
                        to={item.path}
                        className="group inline-flex items-center gap-1 text-sm font-medium text-white/65 no-underline transition-colors hover:text-white"
                      >
                        {item.label}
                        <ArrowUpRight className="h-3 w-3 opacity-0 transition-all duration-200 group-hover:opacity-100" aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            </div>

            {/* Legal */}
            <div>
              <h4 className="mb-4 text-xs font-bold uppercase tracking-widest text-white/35">Legal</h4>
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                <li>
                  <Link to="/legal" className="group inline-flex items-center gap-1 text-sm font-medium text-white/65 no-underline transition-colors hover:text-white">
                    Privacy Policy
                    <ArrowUpRight className="h-3 w-3 opacity-0 transition-all duration-200 group-hover:opacity-100" aria-hidden="true" />
                  </Link>
                </li>
                <li>
                  <Link to="/legal" className="group inline-flex items-center gap-1 text-sm font-medium text-white/65 no-underline transition-colors hover:text-white">
                    Data Rights
                    <ArrowUpRight className="h-3 w-3 opacity-0 transition-all duration-200 group-hover:opacity-100" aria-hidden="true" />
                  </Link>
                </li>
                <li>
                  <Link to="/legal" className="group inline-flex items-center gap-1 text-sm font-medium text-white/65 no-underline transition-colors hover:text-white">
                    Consent Policy
                    <ArrowUpRight className="h-3 w-3 opacity-0 transition-all duration-200 group-hover:opacity-100" aria-hidden="true" />
                  </Link>
                </li>
              </ul>
            </div>

            {/* Institution */}
            <div>
              <h4 className="mb-4 text-xs font-bold uppercase tracking-widest text-white/35">Institution</h4>
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                <li className="text-sm font-medium text-white/65">
                  University of Rizal System
                </li>
                <li className="text-sm text-white/45">
                  Morong Campus
                </li>
                <li className="text-sm text-white/45">
                  BS Computer Engineering
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-10 border-t border-white/10 pt-6 text-xs text-white/35">
            For research and clinical-support use only. Not a substitute for professional medical diagnosis.
          </div>
        </div>
      </footer>
    </div>
  )
}
