"use client"

import { Outlet, useNavigate, useLocation } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  LayoutDashboard,
  Users,
  LogOut,
  Menu,
} from "lucide-react"
import { useAuth } from "@/hooks/useAuth"
import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { pageVariants } from "@/lib/motion"
import { cn } from "@/lib/utils"

const clinicianNavigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "New Screening", href: "/dashboard/screening", icon: LayoutDashboard },
  { name: "Patients", href: "/dashboard/patients", icon: Users },
  { name: "Screening Records", href: "/dashboard/screenings", icon: LayoutDashboard },
]

const adminNavigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Patients", href: "/dashboard/patients", icon: Users },
  { name: "Users", href: "/dashboard/admin", icon: Users },
]

export function Layout() {
  const { user, loading, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    document.documentElement.classList.remove("dark")
  }, [])

  const handleSignOut = async () => {
    await signOut()
    navigate("/login")
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  const isAdmin = user?.role === "admin" || user?.role === "super_admin"

  return (
    <div className="min-h-screen bg-cough-surface">
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      )}

      <div className="flex">
        <aside
          id="sidebar"
          className={cn(
            "fixed inset-y-0 left-0 z-50 w-64 transform bg-cough-elevated border-r border-cough-border-soft transition-transform duration-200 ease-in-out lg:translate-x-0",
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <div className="flex h-16 items-center justify-between px-4 border-b border-cough-border-soft">
            <h2 className="text-xl font-semibold text-cough-text">COUGHPH</h2>
            <motion.button
              whileTap={{ scale: 0.88 }}
              transition={{ type: "spring", stiffness: 500, damping: 20 }}
              className="lg:hidden p-2 rounded-md text-cough-muted hover:bg-cough-surface-alt"
              onClick={() => setSidebarOpen(false)}
              aria-label="Close sidebar"
              aria-expanded={sidebarOpen}
              aria-controls="sidebar"
            >
              <Menu className="h-6 w-6" />
            </motion.button>
          </div>

          <nav className="p-4 space-y-1">
            {(isAdmin ? adminNavigation : clinicianNavigation).map((item) => (
              <motion.button
                key={item.name}
                whileTap={{ scale: 0.96 }}
                transition={{ type: "spring", stiffness: 400, damping: 17 }}
                onClick={() => {
                  navigate(item.href)
                  setSidebarOpen(false)
                }}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  "text-cough-muted hover:bg-cough-surface-alt"
                )}
              >
                <item.icon className="h-5 w-5" aria-hidden="true" />
                {item.name}
              </motion.button>
            ))}
          </nav>

          <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-cough-border-soft">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-start gap-3">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={user?.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${user?.full_name || "User"}`} alt={user?.full_name || ""} />
                    <AvatarFallback>{user?.full_name?.charAt(0).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="text-left">
                    <p className="text-sm font-medium truncate">{user?.full_name}</p>
                    <p className="text-xs text-cough-muted capitalize">
                      {user?.role?.replace("_", " ")}
                    </p>
                  </div>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuItem className="cursor-default text-sm text-cough-muted px-2 py-1">
                  {user?.email}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} className="text-red-600">
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </aside>

        <div className="flex-1 lg:pl-64">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-4 px-4 bg-cough-elevated/90 backdrop-blur-md border-b border-cough-border-soft lg:px-8">
            <motion.button
              whileTap={{ scale: 0.88 }}
              transition={{ type: "spring", stiffness: 500, damping: 20 }}
              className="lg:hidden p-2 rounded-md text-cough-muted hover:bg-cough-surface-alt"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="h-6 w-6" />
            </motion.button>
            <h2 className="text-lg font-semibold text-cough-text">COUGHPH</h2>
            <div className="flex-1" />
          </header>

          <AnimatePresence mode="wait">
            <motion.main
              id="main-content"
              key={location.pathname}
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="p-4 lg:p-8"
            >
              <Outlet />
            </motion.main>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}