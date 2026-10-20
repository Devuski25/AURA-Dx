import { useEffect, lazy, Suspense } from "react"
import { Toaster } from "@/components/ui/sonner"
import { Layout } from "@/components/layout/Layout"
import { PublicLayout } from "@/components/public/PublicLayout"
import { Login } from "@/pages/Login"
import { Register } from "@/pages/Register"
import { AuthCallback } from "@/pages/AuthCallback"
import { ResetPassword } from "@/pages/ResetPassword"
import { Home } from "@/pages/public/Home"
import { About } from "@/pages/public/About"
import { Team } from "@/pages/public/Team"
import { Legal } from "@/pages/public/Legal"
import { PublicHelpSupport } from "@/pages/public/HelpSupport"
import { AuthProvider } from "@/context/AuthContext"
import { BackendWatchdog } from "@/components/BackendWatchdog"
import { ErrorBoundary } from "@/components/ErrorBoundary"
import { AnalysisWatcherProvider } from "@/lib/analysis-watcher"
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom"
import { useAuth } from "@/hooks/useAuth"

// Lazy loaded heavy components
/* Dashboard is lazy even though it is not one of the original five.

   It is authenticated, so a signed-out visitor can never render it -- yet as an
   eager import its code shipped inside the entry chunk and was downloaded by
   everyone, including the Login page, on every cold load. The other eager pages
   (Home, About, Team, Legal, Login, Register) are public and genuinely needed
   by a first-time visitor, so they stay eager; trading marketing-page polish
   for login-page speed is a call for the owner, not a silent default.

   No UX cost either way: PrivateRoute already shows a full-screen spinner while
   auth resolves, and the route sits inside the existing <Suspense>. */
const Dashboard = lazy(() => import("@/pages/Dashboard").then(m => ({ default: m.Dashboard })))
const Screening = lazy(() => import("@/pages/Screening").then(m => ({ default: m.Screening })))
const PatientRecords = lazy(() => import("@/pages/PatientRecords").then(m => ({ default: m.PatientRecords })))
const PatientDetail = lazy(() => import("@/pages/PatientDetail").then(m => ({ default: m.PatientDetail })))
const ScreeningDetail = lazy(() => import("@/pages/ScreeningDetail").then(m => ({ default: m.ScreeningDetail })))
const Admin = lazy(() => import("@/pages/Admin").then(m => ({ default: m.Admin })))

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

  /* Signed in but not approved.

     Sent to /login, which is not a dead end -- it renders a status-specific
     screen (Awaiting Approval / Access Denied) with a Sign Out button. That
     matters because redirecting somewhere that redirects back here is what
     produced the unbreakable loop: tap "Go to Dashboard", get bounced to
     /login, sign-in page offers the dashboard again, forever. `replace` keeps
     the protected URL out of history so Back does not walk the loop again. */
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
        <Route path="/help-support" element={<PublicHelpSupport />} />
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
        <Route path="screenings" element={<Suspense fallback={<SuspenseLoader />}><PatientRecords /></Suspense>} />
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

      {/* Fallback: redirect unknown routes to home */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function App() {
  return (
    /* Outermost, so it also catches a crash inside AuthProvider — which is
       where a failed Supabase session load lands. Inside BrowserRouter so the
       fallback screen keeps the router context if it ever needs to navigate. */
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          {/* Watches running analyses and announces them when they land.
              It sits above the routes on purpose: the clinician who needs
              telling is usually NOT on the screening page any more -- they
              submitted, walked off to another patient, and the result arrived
              while they were somewhere else entirely. A watcher mounted on the
              screening page unmounts with it, which is exactly the case that
              needs watching. */}
          <AnalysisWatcherProvider>
            <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-background focus:text-foreground focus:rounded-md focus:ring-2 focus:ring-ring">
              Skip to main content
            </a>
            <ScrollToTop />
            <AppRoutes />
            {/* Renders nothing; tells the user once if the backend disappears while
                they are working, rather than letting buttons fail unexplained. */}
            <BackendWatchdog />
            <Toaster />
          </AnalysisWatcherProvider>
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  )
}

export default App