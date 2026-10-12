import { Link, Outlet, useLocation } from "react-router-dom"
import { AnimatePresence, motion, useScroll, useSpring } from "framer-motion"
import { pageVariants } from "@/lib/motion"
import { Logo } from "@/components/layout/Logo"
import { cn } from "@/lib/utils"
import { ArrowUpRight, Home, Info, LifeBuoy, ShieldCheck, Users, HelpCircle } from "lucide-react"
import { FloatingHelpButton } from "@/components/FloatingHelpButton"

const NAV_ITEMS = [
  { label: "Home", path: "/", icon: Home },
  { label: "About System", path: "/about", icon: Info },
  { label: "Our Team", path: "/team", icon: Users },
  { label: "Legal & Privacy", path: "/legal", icon: ShieldCheck },
]

const MOBILE_NAV_ITEMS = [
  { label: "Home", path: "/", icon: Home },
  { label: "About System", path: "/about", icon: Info },
  { label: "Our Team", path: "/team", icon: Users },
  { label: "Legal & Privacy", path: "/legal", icon: ShieldCheck },
  { label: "Help & Support", path: "/help-support", icon: LifeBuoy },
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

function NavLinks() {
  const { pathname } = useLocation()
  return (
    <ul className="m-0 flex list-none flex-col gap-1 lg:flex-row lg:gap-0">
      {NAV_ITEMS.map((item) => (
        <li key={item.path}>
          <Link
            to={item.path}
            className={`block rounded-lg px-4 py-2.5 text-sm font-semibold no-underline transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-accent focus-visible:ring-offset-2 ${
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
  const { pathname } = useLocation()

  return (
    <div className="min-h-screen bg-aura-bg pb-20 font-[Poppins,sans-serif] text-aura-text lg:pb-0">
      <ScrollProgress />

      {/* ·"?·"?·"? Main header ·"?·"?·"? */}
      <header className="sticky top-0 z-50 border-b border-aura-border-soft/40 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3">
          <Link
            to="/"
            aria-label="AURA-Dx — Acoustic Unit for Respiratory Assessment"
            className="flex shrink-0 items-center text-aura-text no-underline"
          >
            <Logo size="lg" />
          </Link>

          {/* Desktop nav */}
          <nav className="hidden lg:block">
            <NavLinks />
          </nav>

          {/* CTA button */}
          <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }} transition={{ type: "spring", stiffness: 400, damping: 17 }}>
            <Link
              to="/login"
                className="block shrink-0 rounded-full bg-aura-forest px-6 py-2.5 text-sm font-bold text-white no-underline shadow-lg shadow-aura-forest/25 transition-all duration-200 hover:bg-green-700 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-aura-forest"
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

      {/* ·"?·"?·"? Footer ·"?·"?·"? */}
      <footer className="bg-aura-forest px-6 pb-8 pt-14 text-white">
        <div className="mx-auto max-w-7xl">
          {/* Two tracks on desktop instead of three: the thesis attribution
              moved into the brand column, and that column now carries more than
              links, so it takes the wider track. */}
          <div className="grid grid-cols-1 gap-x-6 gap-y-10 lg:grid-cols-[2.2fr_1fr]">
            {/* Brand column */}
            <div>
              <Logo size="md" inverse withSubtitle />
              <p className="mt-4 max-w-xs text-sm leading-relaxed text-aura-footer-link">
                Web-based AI system for respiratory disease screening via breathing sound analysis.
              </p>
              {/* Attribution, folded in from the old third column. The
                  "Institution" heading is gone — the three lines read as a
                  colophon without a label, and the heading was the only thing
                  making it look like a separate link group. */}
              <ul className="m-0 mt-5 flex list-none flex-col gap-1 p-0">
                <li className="text-sm font-medium text-aura-footer-link">
                  University of Rizal System
                </li>
                <li className="text-sm text-aura-footer-link/80">
                  Morong Campus
                </li>
                <li className="text-sm text-aura-footer-link/80">
                  BS Computer Engineering
                </li>
              </ul>
              <div className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-aura-footer-link/40 bg-white/10 px-3 py-1.5 text-[0.8125rem] font-semibold tracking-wide text-aura-footer-link uppercase">
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
                        className="group inline-flex items-center gap-1 text-sm font-medium text-aura-footer-link no-underline transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                      >
                        {item.label}
                        <ArrowUpRight className="h-3 w-3 opacity-0 transition-all duration-200 group-hover:opacity-100" aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
          </div>

          <div className="mt-10 border-t border-white/10 pt-6 text-xs text-white/35">
            For research and clinical-support use only. Not a substitute for professional medical diagnosis.
          </div>
        </div>
      </footer>

      {/* Mobile bottom navigation */}
      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-[60] flex border-t border-aura-border-soft bg-white/95 backdrop-blur-lg lg:hidden"
      >
        {MOBILE_NAV_ITEMS.map((navItem) => {
          const active = pathname === navItem.path
          const Icon = navItem.icon
          return (
            <Link
              key={navItem.path}
              to={navItem.path}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 text-[0.9375rem] font-medium no-underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-aura-accent",
                active ? "bg-aura-accent/10 text-aura-accent" : "text-aura-muted hover:text-aura-text"
              )}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              <span>{navItem.label}</span>
            </Link>
          )
        })}
      </nav>
      <FloatingHelpButton />
    </div>
  )
}