import { Link, Outlet, useLocation } from "react-router-dom"
import { AnimatePresence, motion, useScroll, useSpring } from "framer-motion"
import { pageVariants } from "@/lib/motion"
import { Logo } from "@/components/layout/Logo"
import { cn } from "@/lib/utils"
import { ArrowUpRight, Home, Info, LifeBuoy, ShieldCheck, Users } from "lucide-react"

const NAV_ITEMS = [
  { label: "Home", path: "/", icon: Home },
  { label: "About System", path: "/about", icon: Info },
  { label: "Our Team", path: "/team", icon: Users },
  { label: "Legal & Privacy", path: "/legal", icon: ShieldCheck },
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

      {/* ─── Footer ─── */}
      <footer className="bg-aura-forest px-6 pb-8 pt-14 text-white">
        <div className="mx-auto max-w-7xl">
          <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
            {/* Brand column */}
            <div className="col-span-2 sm:col-span-1 lg:col-span-1">
              <Logo size="md" inverse withSubtitle />
              <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/60">
                Web-based AI system for early detection of respiratory diseases via cough sound analysis.
              </p>
              <div className="mt-4 flex items-center gap-1.5 rounded-full bg-white/8 px-3 py-1.5 text-[0.65rem] font-semibold tracking-wide text-white/50 uppercase">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-aura-accent" />
                Thesis-stage research prototype
              </div>
              <Link
                to="/help-support"
                className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-white/65 no-underline transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              >
                <LifeBuoy className="h-3.5 w-3.5" aria-hidden="true" />
                Help &amp; Support
                <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
              </Link>
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
                        className="group inline-flex items-center gap-1 text-sm font-medium text-white/65 no-underline transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
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

      {/* Mobile bottom navigation */}
      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-[60] flex border-t border-aura-border-soft bg-white/95 backdrop-blur-lg lg:hidden"
      >
        {NAV_ITEMS.map((navItem) => {
          const active = pathname === navItem.path
          const Icon = navItem.icon
          return (
            <Link
              key={navItem.path}
              to={navItem.path}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 text-[0.7rem] font-medium no-underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-aura-accent",
                active ? "bg-aura-accent/10 text-aura-accent" : "text-aura-muted hover:text-aura-text"
              )}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              <span>{navItem.label}</span>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
