"use client"

import { useRef, useEffect } from "react"
import { Link, useLocation } from "react-router-dom"
import { motion, AnimatePresence, useReducedMotion } from "framer-motion"
import {
  AudioLines,
  LayoutDashboard,
  LogOut,
  PanelLeftClose,
  UserCog,
  UsersRound,
} from "lucide-react"
import { Logo } from "@/components/layout/Logo"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useMediaQuery } from "@/lib/useMediaQuery"
import { spring, sidebarSpring, drawerSpring } from "@/lib/motion"
import { cn } from "@/lib/utils"

type NavItem = {
  name: string
  href: string
  icon: typeof LayoutDashboard
}

const clinicianNavigation: NavItem[] = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "New Screening", href: "/dashboard/screening", icon: AudioLines },
  { name: "Patient Records", href: "/dashboard/patient-records", icon: UsersRound },
]

const adminNavigation: NavItem[] = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Patient Records", href: "/dashboard/patient-records", icon: UsersRound },
  { name: "Users", href: "/dashboard/admin", icon: UserCog },
]

type SidebarUser = {
  full_name?: string | null
  email?: string | null
  role?: string | null
  avatar_url?: string | null
}

type SidebarProps = {
  collapsed: boolean
  onToggleCollapsed: () => void
  isAdmin: boolean
  open: boolean
  onClose: () => void
  onSignOut: () => void
  user: SidebarUser | null
}

const COLLAPSED_WIDTH = 72
/* Wide enough for the full "Acoustic Unit for Respiratory Assessment"
   tagline to wrap onto two lines without clipping. Matches DRAWER_WIDTH so the
   rail and the mobile drawer present the same measure. */
const EXPANDED_WIDTH = 288
const DRAWER_WIDTH = 288

export function Sidebar({
  collapsed,
  onToggleCollapsed,
  isAdmin,
  open,
  onClose,
  onSignOut,
  user,
}: SidebarProps) {
  const { pathname } = useLocation()
  const isMobile = !useMediaQuery("(min-width: 1024px)")
  const reduceMotion = useReducedMotion()
  const drawerRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const drawerActive = isMobile && open

  useEffect(() => {
    if (!drawerActive) return
    const el = drawerRef.current
    const first = el?.querySelector<HTMLElement>('a[href], button:not([disabled])')
    first?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onCloseRef.current()
        return
      }
      if (e.key !== "Tab") return
      const focusables = Array.from(
        el?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
        ) ?? []
      )
      if (focusables.length === 0) return
      const firstEl = focusables[0]
      const lastEl = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [drawerActive])

  const items = isAdmin ? adminNavigation : clinicianNavigation
  const width = isMobile ? DRAWER_WIDTH : collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH
  const showLabels = isMobile || !collapsed
  const avatarSrc =
    user?.avatar_url ||
    `https://api.dicebear.com/7.x/initials/svg?seed=${user?.full_name || "User"}`
  const avatarFallback = user?.full_name?.charAt(0).toUpperCase() || "U"

  return (
    <>
      <AnimatePresence>
        {isMobile && open && (
          <motion.div
            key="sidebar-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-black/50"
            onClick={onClose}
            aria-hidden="true"
          />
        )}
      </AnimatePresence>

      <motion.aside
        id="sidebar"
        ref={drawerRef}
        aria-label="Primary navigation"
        aria-hidden={isMobile && !open ? true : undefined}
        inert={isMobile && !open ? true : undefined}
        role={drawerActive ? "dialog" : undefined}
        aria-modal={drawerActive ? true : undefined}
        animate={{
          x: isMobile ? (open ? 0 : -DRAWER_WIDTH) : 0,
          width,
        }}
        transition={
          reduceMotion
            ? { duration: 0 }
            : { x: drawerSpring, width: sidebarSpring }
        }
        className={cn(
          "flex flex-col border-r border-[#16382b] bg-gradient-to-b from-[#2f6b54] via-[#255c46] to-[#1b4535] text-white shadow-[inset_-1px_0_0_rgba(255,255,255,0.07)] print:hidden",
          isMobile
            ? /* h-[100dvh], not inset-y-0.

               `inset-y-0` on a fixed box resolves against the *layout*
               viewport, which on a phone is taller than what is actually on
               screen once browser chrome and the home indicator are accounted
               for. The drawer therefore ran taller than the visible area, and
               its last row fell under the system UI -- the account card and the
               sign-out button with it.

               dvh tracks the viewport as chrome collapses and expands, so the
               drawer is exactly as tall as the space the user can see. Same
               unit Layout.tsx already uses for the main scrollport. */
              "fixed left-0 top-0 z-50 h-[100dvh] shadow-[12px_0_40px_rgba(0,0,0,0.15)]"
            // z-30 on desktop, and it has to be here.
            //
            // Framer animates `width` on this element, which applies a
            // transform, and a transform creates a stacking context. The
            // collapsed-rail tooltip inside is z-50, but that z-50 is scoped
            // *within* this context -- it cannot lift anything past a sibling
            // that competes at the root level.
            //
            // Without an index here the aside sits at z-index auto, while the
            // Dashboard hero banner's inner div is z-10. z-10 beats auto, so the
            // banner painted over the whole sidebar, clipping the tooltip
            // mid-word behind it on every clinician and admin page.
            //
            // z-30 clears the page content (z-10) and stays under the route
            // progress bar (z-[70]) and the mobile drawer (z-50).
            //
            // h-[100dvh] rather than h-screen: 100vh counts the classic
            // scrollbar gutter, so the sidebar could be a few pixels taller than
            // the scrollport it is pinned beside. Identical to 100vh on desktop
            // (no dynamic toolbar), correct everywhere else.
            : "sticky top-0 z-30 h-[100dvh] shrink-0"
        )}
      >
        {/* The drawer is full-bleed on a phone, so it has to clear the notch on
            the left and the gesture bar at the bottom itself. Without this the
            top logo sits under the camera cutout on an iPhone in landscape. */}
        {/* shrink-0: this spacer carries the notch clearance on a phone. It has
            no content of its own, so as a flex item it was free to be squashed
            by the same min-height:auto pressure that was pushing the footer
            out -- exactly when the viewport was shortest and the notch clearance
            mattered most. */}
        <div
          aria-hidden="true"
          className={cn("shrink-0", isMobile && "pt-[var(--aura-safe-top)] pl-[var(--aura-safe-left)]")}
          style={isMobile ? undefined : { display: "none" }}
        />
        <div className="flex shrink-0 items-center justify-between border-b border-white/15 px-3 pb-2 pt-2">
          {/* Logo badge doubles as the sidebar collapse/expand toggle (desktop).
              Geometry mirrors the nav links below: same px-3 gutter, h-11 row,
              so the badge shares the exact vertical center-axis of the icons. */}
          {isMobile ? (
            showLabels ? (
              <Logo withSubtitle inverse />
            ) : (
              <Logo variant="mark" className="mx-auto" />
            )
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <motion.button
                  type="button"
                  onClick={onToggleCollapsed}
                  whileTap={{ scale: 0.98 }}
                  transition={{ type: "spring", stiffness: 400, damping: 17 }}
                  aria-label="Toggle sidebar"
                  aria-expanded={!collapsed}
                  aria-controls="sidebar"
                  title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                  className={cn(
                    /* min-h-11, not h-11: the expanded lockup carries a
                       two-line tagline and is taller than 44px. A fixed height
                       overflowed and items-center pushed the tagline into the
                       middle, half-clipped by the divider below. min-h keeps the
                       44px row for the collapsed mark while letting the full
                       wordmark + tagline stack grow and align to the top.
                       Padding only applies when labels show, so the collapsed
                       rail stays at exactly 44px. */
                    "flex min-h-11 w-full cursor-pointer items-start rounded-lg px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
                    showLabels ? "justify-start py-2" : "justify-center items-center py-0"
                  )}
                >
                  {showLabels ? (
                    <Logo withSubtitle inverse />
                  ) : (
                    <Logo variant="mark" />
                  )}
                </motion.button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {collapsed ? "Expand sidebar" : "Collapse sidebar"}
              </TooltipContent>
            </Tooltip>
          )}
          <motion.button
            whileTap={{ scale: 0.88 }}
            transition={{ type: "spring", stiffness: 500, damping: 20 }}
            className={cn(
              "rounded-md p-2 text-white transition-colors hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
              !isMobile && "hidden"
            )}
            onClick={onClose}
            aria-label="Close sidebar"
          >
            <PanelLeftClose className="h-6 w-6" aria-hidden="true" />
          </motion.button>
        </div>

        {/* min-h-0 is what keeps the sign-out button on screen.

            This is a flex column: header, nav, footer. `flex-1` alone was not
            enough, because a flex item's default `min-height: auto` refuses to
            shrink below its content's intrinsic height. The nav could therefore
            never be smaller than its links plus padding, so once header + nav +
            footer exceeded the sidebar's height the nav just pushed the footer
            down and out of the box -- nothing stopped it. The account card and
            the sign-out button went below the bottom edge, and the only way to
            reach them was to scroll the page, which moved the whole aside and
            made it read as "scrolled away" rather than "clipped".

            `min-h-0` removes that floor. `overflow-y-auto` then lets the nav
            scroll inside itself when the viewport really is too short, so the
            footer stays pinned instead of the sidebar overflowing. That matters
            most in landscape on a phone, and on a tablet with the keyboard up.

            `overscroll-contain` stops a scroll that runs out of nav from
            chaining through to the page behind the drawer.

            These apply at EVERY breakpoint, not just below lg. The first pass
            scoped them to `isMobile` to protect the collapsed-rail tooltips from
            being clipped -- and that missed the tablet, which renders the
            desktop rail (it is >=1024px) at a short height. Same overflow, same
            cut-off footer, in a viewport the mobile-only rule never reached.
            The tooltip problem is solved at its actual source below rather than
            by keeping the sidebar out of a scroll container it genuinely needs.

            The bottom safe-area padding moved to the footer below: it belongs to
            the bottom-most element, and here it was reserving room for the home
            indicator ABOVE the footer rather than below it -- so the very row
            that needed the clearance was the one sitting in it. */}
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-3 pb-3 pt-1">
          {items.map((item) => {
            const isActive =
              item.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(item.href)

            /* Built once and placed either bare or inside a tooltip trigger.
               Written this way rather than duplicated per branch so there is
               exactly one <Link> in the DOM per nav item -- an overlay copy
               would double the tab stops and make the same destination reachable
               twice. */
            const link = (
              <Link
                to={item.href}
                onClick={onClose}
                aria-label={showLabels ? undefined : item.name}
                /* No native `title` alongside the tooltip. Both were set, so
                   hovering produced two labels -- the browser's, which cannot be
                   styled and always paints over the page, and the styled one.
                   `aria-label` still gives assistive tech the accessible name. */
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "group relative z-10 flex min-h-[44px] items-center rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
                  showLabels ? "justify-start" : "justify-center",
                  isActive
                    ? "text-[#14382a]"
                    : "text-[#dff0e7] hover:bg-white/10 hover:text-white"
                )}
              >
                <motion.span
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.96 }}
                  transition={{ type: "spring", stiffness: 400, damping: 17 }}
                  /* gap-3 only when the label is showing.

                     The label stays mounted at width 0 so it can fade without a
                     layout shift, but a zero-width flex item still consumes the
                     gap. On the 72px collapsed rail that left the icon centred
                     within a 32px block -- 20px icon + 12px of dead space --
                     putting it 6px left of the rail's centre. Half the gap,
                     and it read as the whole column being misaligned.

                     px-3 is symmetric so it does not contribute to the offset;
                     the gap was the only asymmetry. */
                  className={cn(
                    "flex min-w-0 items-center",
                    showLabels ? "gap-3" : "gap-0"
                  )}
                >
                  <item.icon
                    className={cn(
                      "h-5 w-5 shrink-0 transition-transform duration-150",
                      // Collapsed rail leans on the scale nudge; expanded gets
                      // a 2px slide so every nav item nudges the same way.
                      !showLabels
                        ? "group-hover:scale-110"
                        : "motion-safe:group-hover:translate-x-0.5"
                    )}
                    aria-hidden="true"
                  />
                  {/* Label stays mounted and fades/collapses with the panel
                      width so text never clips or shifts layout mid-toggle */}
                  <motion.span
                    initial={false}
                    animate={{ opacity: showLabels ? 1 : 0, width: showLabels ? "auto" : 0 }}
                    transition={
                      reduceMotion
                        ? { duration: 0 }
                        : { width: sidebarSpring, opacity: { duration: 0.18, ease: "easeOut" } }
                    }
                    aria-hidden={!showLabels}
                    className="overflow-hidden whitespace-nowrap"
                  >
                    {item.name}
                  </motion.span>
                </motion.span>
              </Link>
            )

            return (
              <div key={item.name} className="relative">
                {isActive && (
                  <motion.span
                    layoutId="activeNav"
                    transition={reduceMotion ? { duration: 0 } : spring.snappy}
                    className="absolute inset-0 rounded-lg bg-white/90 shadow-aura-sm"
                  />
                )}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-1/2 z-10 h-6 w-1 -translate-y-1/2 rounded-r-full bg-aura-accent"
                  />
                )}

                {/* Collapsed-rail tooltip.

                    Radix, not the hand-rolled <motion.span role="tooltip"> this
                    replaces. That one was an absolutely-positioned descendant of
                    the nav item, and the nav is now a scroll container -- and
                    setting `overflow-y` to anything but `visible` makes
                    `overflow-x` compute to `auto` per spec, so a tooltip at
                    `left-full` would have been clipped by the nav's own box.
                    Radix's TooltipContent renders through a Portal to
                    document.body and escapes every overflow ancestor regardless.

                    It also removes the last duplicate of a component this file
                    already imports and uses for the logo toggle and the sign-out
                    button: one tooltip implementation, one delay, one look. The
                    visible change is a 200ms hover delay and Radix's fade/zoom
                    instead of a spring -- matching the other two tooltips here. */}
                {showLabels ? (
                  link
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>{link}</TooltipTrigger>
                    <TooltipContent side="right">{item.name}</TooltipContent>
                  </Tooltip>
                )}
              </div>
            )
          })}
        </nav>

          {/* Pinned to the bottom of the sidebar and never scrolled: `shrink-0` plus the
            nav's `min-h-0` above is what guarantees the account card and the
            sign-out button stay visible at every viewport height, for both
            roles. This is the row that used to fall off the bottom.

            Padding is written out per-edge rather than as `p-3` so the bottom
            is unambiguous: `max(0.75rem, safe-bottom)` clears the iOS home
            indicator and the Android gesture bar, which `p-3` alone did not. */}
        <div className="shrink-0 border-t border-white/15 px-3 pt-3 pb-[max(0.75rem,var(--aura-safe-bottom))]">
          {showLabels ? (
            <div className="flex items-start gap-3 rounded-xl border border-white/20 bg-white/10 p-3 transition-[background-color,transform] duration-200 hover:bg-white/15 motion-safe:hover:-translate-y-px">
              <Avatar className="h-9 w-9 shrink-0">
                <AvatarImage
                  src={avatarSrc}
                  alt={user?.full_name || ""}
                />
                <AvatarFallback>{avatarFallback}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">
                  {user?.full_name || "Clinician"}
                </p>
                <p className="mt-1.5 flex items-center">
                  <span
                    className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full border border-aura-accent/40 bg-aura-accent/20 px-2.5 py-0.5 text-[0.75rem] font-semibold uppercase tracking-wider text-white"
                    title={`Signed in as ${user?.role?.replace("_", " ") || "Clinician"}`}
                  >
                    <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden="true">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-aura-accent opacity-40" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-aura-accent" />
                    </span>
                    <span className="truncate">
                      {user?.role?.replace("_", " ") || "Clinician"}
                    </span>
                  </span>
                </p>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.92 }}
                    transition={{ type: "spring", stiffness: 400, damping: 17 }}
                    onClick={onSignOut}
                    aria-label="Sign out"
                    className="rounded-lg p-2 text-white/80 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 shrink-0"
                  >
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                  </motion.button>
                </TooltipTrigger>
                <TooltipContent side="right">Sign out</TooltipContent>
              </Tooltip>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <div className="relative">
                <Avatar className="h-10 w-10" title={user?.full_name || "Clinician"}>
                  <AvatarImage src={avatarSrc} alt={user?.full_name || ""} />
                  <AvatarFallback>{avatarFallback}</AvatarFallback>
                </Avatar>
                <span
                  aria-hidden="true"
                  title={user?.role?.replace("_", " ") || "Clinician"}
                  className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-white/60 bg-aura-accent text-[13.5px] font-bold uppercase text-white"
                >
                  {(user?.role || "c").charAt(0).toUpperCase()}
                </span>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.92 }}
                    transition={{ type: "spring", stiffness: 400, damping: 17 }}
                    onClick={onSignOut}
                    aria-label="Sign out"
                    className="rounded-lg p-2 text-white/80 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                  >
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                  </motion.button>
                </TooltipTrigger>
                <TooltipContent side="right">Sign out</TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>
      </motion.aside>
    </>
  )
}
