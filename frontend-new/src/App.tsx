import { useEffect, lazy, Suspense } from "react"
import { Toaster } from "@/components/ui/sonner"
import { Layout } from "@/components/layout/Layout"
import { PublicLayout } from "@/components/public/PublicLayout"
import { Login } from "@/pages/Login"
import { Register } from "@/pages/Register"
import { AuthCallback } from "@/pages/AuthCallback"
import { ResetPassword } from "@/pages/ResetPassword"
import { Dashboard } from "@/pages/Dashboard"
import { Home } from "@/pages/public/Home"
import { About } from "@/pages/public/About"
import { Team } from "@/pages/public/Team"
import { Legal } from "@/pages/public/Legal"
import { AuthProvider } from "@/context/AuthContext"
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom"
import { useAuth } from "@/hooks/useAuth"

// Lazy loaded heavy components
const Screening = lazy(() => import("@/pages/Screening").then(m => ({ default: m.Screening })))
const PatientRecords = lazy(() => import("@/pages/PatientRecords").then(m => ({ default: m.PatientRecords })))
const PatientDetail = lazy(() => import("@/pages/PatientDetail").then(m => ({ default: m.PatientDetail })))
const ScreeningDetail = lazy(() => import("@/pages/ScreeningDetail").then(m => ({ default: m.ScreeningDetail })))
const Admin = lazy(() => import("@/pages/Admin").then(m => ({ default: m.Admin })))
const HelpSupport = lazy(() => import("@/pages/HelpSupport").then(m => ({ default: m.HelpSupport })))

function SuspenseLoader() {
  return (
    <div className="flex h-[50vh] w-full items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  )
}

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

  if (user.status !== "approved") {
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
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/reset-password" element={<ResetPassword />} />

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
        <Route path="screening" element={<Suspense fallback={<SuspenseLoader />}><Screening /></Suspense>} />
        <Route path="patient-records" element={<Suspense fallback={<SuspenseLoader />}><PatientRecords /></Suspense>} />
        <Route path="screenings" element={<Suspense fallback={<SuspenseLoader />}><PatientRecords defaultTab="screenings" /></Suspense>} />
        <Route path="patients" element={<Suspense fallback={<SuspenseLoader />}><PatientRecords defaultTab="patients" /></Suspense>} />
        <Route path="patients/:id" element={<Suspense fallback={<SuspenseLoader />}><PatientDetail /></Suspense>} />
        <Route path="screenings/:id" element={<Suspense fallback={<SuspenseLoader />}><ScreeningDetail /></Suspense>} />
        <Route
          path="admin"
          element={
            <PrivateRoute allowedRoles={["admin", "super_admin"]}>
              <Suspense fallback={<SuspenseLoader />}>
                <Admin />
              </Suspense>
            </PrivateRoute>
          }
        />
      </Route>

      {/* Standalone help & support (authenticated, role-aware) */}
      <Route
        path="/help-support"
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        <Route index element={<Suspense fallback={<SuspenseLoader />}><HelpSupport /></Suspense>} />
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