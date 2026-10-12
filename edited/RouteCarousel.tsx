import { useLayoutEffect, useState, type ReactNode } from "react"
import { useLocation, useOutlet, type Location } from "react-router-dom"
import { AnimatePresence, motion, useReducedMotion, type Variants } from "framer-motion"
import { EASE_IN_OUT } from "@/lib/fine-motion"
import { ScrollProgress } from "@/components/ScrollProgress"

/** Left-to-right order of the pages, like slides in a carousel. Adjust the paths to match your router. */
const ORDER = ["/", "/about", "/team", "/legal"]

const normalize = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p)

function directionBetween(from: string, to: string) {
  const a = ORDER.indexOf(normalize(from))
  const b = ORDER.indexOf(normalize(to))
  if (a === -1 || b === -1) return 0 // pages outside the order (login, dashboard...) just crossfade
  return Math.sign(b - a)
}

/* Both pages move together like a filmstrip. The page that is not "in focus" is slightly smaller and dimmer,
   the same feel as the Team carousel. dir: 1 = going forward (new page comes from the right), -1 = back. */
const variants: Variants = {
  enter: (dir: number) => ({ x: dir === 0 ? 0 : `${dir * 100}%`, scale: dir === 0 ? 1 : 0.94, opacity: dir === 0 ? 0 : 0.4 }),
  center: { x: 0, scale: 1, opacity: 1, transition: { duration: 0.85, ease: EASE_IN_OUT } },
  exit: (dir: number) => ({
    x: dir === 0 ? 0 : `${dir * -100}%`,
    scale: dir === 0 ? 1 : 0.94,
    opacity: dir === 0 ? 0 : 0.4,
    transition: { duration: 0.85, ease: EASE_IN_OUT },
  }),
}

/**
 * Usage A, in a layout route: replace <Outlet /> with <RouteCarousel />.
 * Usage B, <Routes> declared directly:
 *   <RouteCarousel>{(location) => <Routes location={location}>...</Routes>}</RouteCarousel>
 */
export function RouteCarousel({ children }: { children?: (location: Location) => ReactNode }) {
  const location = useLocation()
  const outlet = useOutlet()
  const reduce = useReducedMotion()
  const { pathname, hash } = location

  // Work out the slide direction when the path changes (derived state, set during render).
  const [nav, setNav] = useState({ path: pathname, dir: 0 })
  if (nav.path !== pathname) setNav({ path: pathname, dir: directionBetween(nav.path, pathname) })

  // Start every page at the top, unless the link points at an #anchor.
  useLayoutEffect(() => {
    if (!hash) window.scrollTo(0, 0)
  }, [pathname, hash])

  const content = children ? children(location) : outlet

  if (reduce) return <>{content}</>

  return (
    <>
      <ScrollProgress />
      {/* overflow-clip (not hidden) hides the sideways slide without breaking position: sticky */}
      <div className="relative overflow-clip">
        <AnimatePresence mode="popLayout" initial={false} custom={nav.dir}>
          <motion.div key={pathname} custom={nav.dir} variants={variants} initial="enter" animate="center" exit="exit">
            {content}
          </motion.div>
        </AnimatePresence>
      </div>
    </>
  )
}
