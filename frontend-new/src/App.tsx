import { useEffect } from "react"
import { Toaster } from "@/components/ui/sonner"
import { Layout } from "@/components/layout/Layout"
import { PublicLayout } from "@/components/public/PublicLayout"
import { Login } from "@/pages/Login"
import { Register } from "@/pages/Register"
import { Dashboard } from "@/pages/Dashboard"
import { Screening } from "@/pages/Screening"
import { Screenings } from "@/pages/Screenings"
import { Patients } from "@/pages/Patients"
import { PatientDetail } from "@/pages/PatientDetail"
import { ScreeningDetail } from "@/pages/ScreeningDetail"
import { Admin } from "@/pages/Admin"
import { Home } from "@/pages/public/Home"
import { About } from "@/pages/public/About"
import { Team } from "@/pages/public/Team"
import { Legal } from "@/pages/public/Legal"
import { AuthProvider } from "@/context/AuthContext"
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom"
import { useAuth } from "@/hooks/useAuth"

function PrivateRoute({ children, allowedRoles }: { children: React.ReactNode; allowedRoles?: string[] }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  return null
}

function AppRoutes() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  return (
    <Routes>
      {/* Public marketing pages */}
      <Route element={<PublicLayout />}>
        <Route index element={<Home />} />
        <Route path="/about" element={<About />} />
        <Route path="/team" element={<Team />} />
        <Route path="/legal" element={<Legal />} />
      </Route>

      {/* Auth pages */}
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route path="/register" element={user ? <Navigate to="/dashboard" replace /> : <Register />} />

      {/* Authenticated app */}
      <Route
        path="/dashboard"
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="screening" element={<Screening />} />
        <Route path="screenings" element={<Screenings />} />
        <Route path="patients" element={<Patients />} />
        <Route path="patients/:id" element={<PatientDetail />} />
        <Route path="screenings/:id" element={<ScreeningDetail />} />
        <Route
          path="admin"
          element={
            <PrivateRoute allowedRoles={["admin", "super_admin"]}>
              <Admin />
            </PrivateRoute>
          }
        />
      </Route>

      {/* Fallback: redirect unknown routes to home */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-background focus:text-foreground focus:rounded-md focus:ring-2 focus:ring-ring">
          Skip to main content
        </a>
        <ScrollToTop />
        <AppRoutes />
        <Toaster />
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App