"use client"

import { useState, useRef, useEffect } from "react"
import { Link, useLocation } from "react-router-dom"
import { motion, AnimatePresence, useReducedMotion } from "framer-motion"
import {
  AudioLines,
  ClipboardList,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  PanelLeftClose,
  UserCog,
  UsersRound,
} from "lucide-react"
import { Logo } from "@/components/layout/Logo"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useMediaQuery } from "@/lib/useMediaQuery"
import { spring, sidebarSpring, drawerSpring, tooltipVariants } from "@/lib/motion"
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
const EXPANDED_WIDTH = 256
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
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)
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
          "flex flex-col border-r border-[#16382b] bg-gradient-to-b from-[#2f6b54] to-[#1b4535] text-white print:hidden",
          isMobile
            ? "fixed inset-y-0 left-0 z-50 shadow-[12px_0_40px_rgba(0,0,0,0.15)]"
            : "sticky top-0 h-screen shrink-0"
        )}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-white/15 px-3 pb-1 pt-2">
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
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.92 }}
                  transition={{ type: "spring", stiffness: 400, damping: 17 }}
                  aria-label="Toggle sidebar"
                  aria-expanded={!collapsed}
                  aria-controls="sidebar"
                  title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                  className={cn(
                    "flex h-11 w-full cursor-pointer items-center rounded-lg px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
                    showLabels ? "justify-start" : "justify-center"
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

        <nav className="flex-1 space-y-1 px-3 pb-3 pt-1">
          {items.map((item) => {
            const isActive =
              item.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(item.href)

            return (
              <div
                key={item.name}
                className="relative"
                onMouseEnter={() => setHoveredItem(item.name)}
                onMouseLeave={() => setHoveredItem(null)}
              >
                {isActive && (
                  <motion.span
                    layoutId="activeNav"
                    transition={reduceMotion ? { duration: 0 } : spring.snappy}
                    className="absolute inset-0 rounded-lg bg-white/90 shadow-aura-sm"
                  />
                )}
                <Link
                  to={item.href}
                  onClick={onClose}
                  aria-label={showLabels ? undefined : item.name}
                  title={showLabels ? undefined : item.name}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "group relative z-10 flex min-h-[44px] items-center rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
                    showLabels ? "justify-start" : "justify-center",
                    isActive
                      ? "text-[#14382a]"
                      : "text-[#dff0e7] hover:bg-black/10 hover:text-white"
                  )}
                >
                  <motion.span
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.96 }}
                    transition={{ type: "spring", stiffness: 400, damping: 17 }}
                    className="flex min-w-0 items-center gap-3"
                  >
                    <item.icon className={cn("h-5 w-5 shrink-0 transition-transform duration-150", !showLabels && "group-hover:scale-110")} aria-hidden="true" />
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

                <AnimatePresence>
                  {!showLabels && hoveredItem === item.name && (
                    <motion.span
                      role="tooltip"
                      variants={tooltipVariants}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-lg bg-[#132420] px-3 py-1.5 text-xs font-medium text-white shadow-aura-md"
                    >
                      {item.name}
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            )
          })}
        </nav>

        <div className="shrink-0 border-t border-white/15 p-3">
          {showLabels ? (
            <Link
              to="/help-support"
              onClick={onClose}
              className="mb-2 flex min-h-[44px] items-center gap-3 rounded-lg px-3 text-sm font-medium text-[#dff0e7] transition-colors hover:bg-black/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              <LifeBuoy className="h-5 w-5 shrink-0" aria-hidden="true" />
              Help &amp; Support
            </Link>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  to="/help-support"
                  onClick={onClose}
                  aria-label="Help and support"
                  title="Help and support"
                  className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-lg text-[#dff0e7] transition-colors hover:bg-black/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                >
                  <LifeBuoy className="h-5 w-5" aria-hidden="true" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">Help &amp; Support</TooltipContent>
            </Tooltip>
          )}
          {showLabels ? (
            <div className="flex items-center gap-3 rounded-xl border border-white/20 bg-white/10 p-3">
              <Avatar className="h-9 w-9">
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
                <p className="flex items-center gap-1.5 text-xs capitalize text-[#dff0e7]">
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-aura-accent opacity-40" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-aura-accent" />
                  </span>
                  <span className="truncate">
                    {user?.role?.replace("_", " ") || "Clinician"}
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
                    className="rounded-lg p-2 text-white/80 transition-colors hover:bg-black/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                  >
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                  </motion.button>
                </TooltipTrigger>
                <TooltipContent side="right">Sign out</TooltipContent>
              </Tooltip>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Avatar className="h-10 w-10" title={user?.full_name || "Clinician"}>
                <AvatarImage src={avatarSrc} alt={user?.full_name || ""} />
                <AvatarFallback>{avatarFallback}</AvatarFallback>
              </Avatar>
              <Tooltip>
                <TooltipTrigger asChild>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.92 }}
                    transition={{ type: "spring", stiffness: 400, damping: 17 }}
                    onClick={onSignOut}
                    aria-label="Sign out"
                    className="rounded-lg p-2 text-white/80 transition-colors hover:bg-black/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
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