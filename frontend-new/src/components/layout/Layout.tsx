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

/* Route-aware page title shown in the top bar (B1: the AURA-Dx logo already
   lives in the sidebar, so the header carries context instead of a dup logo) */
const PAGE_TITLES: { match: (p: string) => boolean; title: string; crumb: string }[] = [
  { match: p => p === "/dashboard", title: "Dashboard", crumb: "Overview" },
  { match: p => p.startsWith("/dashboard/screening/"), title: "Screening Result", crumb: "Screening Records" },
  { match: p => p === "/dashboard/screening", title: "New Screening", crumb: "Screening" },
  { match: p => p === "/dashboard/patient-records", title: "Patient Records", crumb: "Records" },
  { match: p => p.startsWith("/dashboard/patients/"), title: "Patient Detail", crumb: "Patient Records" },
  { match: p => p === "/dashboard/patients", title: "Patients", crumb: "Records" },
  { match: p => p.startsWith("/dashboard/admin"), title: "User Management", crumb: "Administration" },
  { match: p => p === "/dashboard/help-support", title: "Help & Support", crumb: "Support" },
]

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
  const pageInfo = PAGE_TITLES.find(entry => entry.match(location.pathname))

  return (
    <div className="min-h-screen overflow-x-clip bg-aura-surface">
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
        <div className="flex h-[100dvh] min-w-0 flex-1 flex-col overflow-y-auto">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-aura-border-soft bg-aura-elevated/90 px-4 backdrop-blur-md lg:px-6 print:hidden">
            <Tooltip>
              <TooltipTrigger asChild>
                <motion.button
                  whileTap={{ scale: 0.88 }}
                  transition={{ type: "spring", stiffness: 500, damping: 20 }}
                  className="rounded-md p-2.5 text-aura-muted transition-colors hover:bg-aura-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-brand lg:hidden"
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

            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-[0.95rem] font-semibold leading-tight text-aura-ink">
                {pageInfo?.title ?? "AURA-Dx"}
              </p>
              <p className="truncate text-xs text-aura-muted">
                {pageInfo ? pageInfo.crumb : "Acoustic Unit for Respiratory Analysis"}
              </p>
            </div>
          </header>

          <AnimatePresence mode="wait">
            <motion.main
              id="main-content"
              key={location.pathname}
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="p-4 lg:p-6 print:p-0"
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