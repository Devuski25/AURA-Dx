"use client"

import { Outlet, useNavigate, useLocation } from "react-router-dom"
import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Menu } from "lucide-react"
import { Sidebar } from "@/components/layout/Sidebar"
import { ScrollTopButton } from "@/components/ScrollTopButton"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/useAuth"
import { pageVariants } from "@/lib/motion"

const STORAGE_KEY = "aura-dx:sidebar-collapsed"

/* Route-change progress bar (motion spec #1): a 3px brand gradient fixed to
   the viewport top, scaleX-driven so it's compositor-only. Shows instantly on
   route change, fades out ~350ms later - pure polish, never blocks painting. */
function RouteProgress() {
  const { pathname } = useLocation()
  const [active, setActive] = useState(false)

  useEffect(() => {
    setActive(true)
    const t = window.setTimeout(() => setActive(false), 350)
    return () => window.clearTimeout(t)
  }, [pathname])

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key={pathname}
          aria-hidden="true"
          className="aura-route-progress z-[70]"
          initial={{ scaleX: 0, opacity: 1 }}
          animate={{ scaleX: 1 }}
          exit={{ opacity: 0 }}
          transition={{
            scaleX: { duration: 0.3, ease: [0.16, 1, 0.3, 1] },
            opacity: { duration: 0.18, delay: 0.17 },
          }}
        />
      )}
    </AnimatePresence>
  )
}

/* PAGE_TITLES was removed along with the top title bar. Route-aware titles now
   live inside each page's own card header. */

function getInitialCollapsed() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

export function Layout() {
  const { user, loading, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(getInitialCollapsed)
  const [logoutOpen, setLogoutOpen] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0")
    } catch {
      /* ignore */
    }
  }, [collapsed])

  const handleSignOut = () => {
    setLogoutOpen(true)
  }

  const confirmSignOut = async () => {
    setLogoutOpen(false)
    await signOut()
    navigate("/login")
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div role="status" aria-label="Loading" className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  const isAdmin = user?.role === "admin" || user?.role === "super_admin"
  return (
    <div className="min-h-screen overflow-x-clip bg-gradient-to-b from-aura-canvas-from to-aura-canvas-to">
      <RouteProgress />
      <div className="flex min-h-screen flex-row">
        <Sidebar
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((prev) => !prev)}
          isAdmin={isAdmin}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onSignOut={handleSignOut}
          user={user}
        />
        <div className="aura-scroll flex h-[100dvh] min-w-0 flex-1 flex-col overflow-y-auto">
          {/* The page title bar was removed. The mobile drawer trigger stays
              as a bare button below `lg` — without it the sidebar would be
              unreachable on small screens. Nothing renders at desktop widths,
              where the sidebar is always visible. */}
          <div className="flex items-center gap-2 px-4 pt-[env(safe-area-inset-top)] lg:hidden print:hidden">
            <Tooltip>
              <TooltipTrigger asChild>
                <motion.button
                  whileTap={{ scale: 0.88 }}
                  transition={{ type: "spring", stiffness: 500, damping: 20 }}
                  className="rounded-md p-2.5 text-aura-muted transition-colors hover-tap:bg-aura-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-brand"
                  onClick={() => setSidebarOpen(true)}
                  aria-label="Open sidebar"
                  aria-expanded={sidebarOpen}
                  aria-controls="sidebar"
                >
                  <Menu className="h-6 w-6" />
                </motion.button>
              </TooltipTrigger>
              <TooltipContent>Open navigation</TooltipContent>
            </Tooltip>
          </div>

          <AnimatePresence mode="wait">
            <motion.main
              id="main-content"
              key={location.pathname}
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              /* The canvas gradient is painted by the outer wrapper so it covers the
                 whole scrollport; <main> stays transparent. */
              className="bg-transparent p-4 pt-[max(1rem,var(--aura-safe-top))] pb-[max(1rem,var(--aura-safe-bottom))] lg:p-6 2xl:p-8 print:bg-none print:p-0"
            >
              <Outlet />
            </motion.main>
          </AnimatePresence>
        </div>
        <ScrollTopButton />

        <Dialog open={logoutOpen} onOpenChange={setLogoutOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Sign out?</DialogTitle>
              <DialogDescription>
                Are you sure you want to log out? You&rsquo;ll need to sign in again to access your account.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setLogoutOpen(false)}>
                Cancel
              </Button>
              <Button onClick={confirmSignOut}>Sign out</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
