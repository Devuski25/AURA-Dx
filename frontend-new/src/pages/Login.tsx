"use client"

import { useState, useEffect } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { motion } from "framer-motion"
import { pageVariants } from "@/lib/motion"
import { Loader2, AlertCircle, Eye, EyeOff, ShieldCheck, ShieldAlert, Clock, Key, ArrowLeft, CheckCircle2, ArrowRight } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useAuth } from "@/hooks/useAuth"
import { GoogleIcon } from "@/components/GoogleIcon"
import { supabase } from "@/lib/supabase"

export function Login() {
  const { signIn, confirmLogin, signInWithOAuth, signOut, user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  useEffect(() => {
    const statusParam = searchParams.get("status")
    if (statusParam === "pending" || statusParam === "rejected" || statusParam === "deleted" || statusParam === "approved") {
      setStatusDialog({ type: statusParam })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [statusDialog, setStatusDialog] = useState<{ type: "pending" | "approved" | "rejected" | "deleted" | "unregistered" } | null>(null)
  const [showForgotPassword, setShowForgotPassword] = useState(false)
  const [forgotEmail, setForgotEmail] = useState("")
  const [forgotLoading, setForgotLoading] = useState(false)
  const [forgotMessage, setForgotMessage] = useState<string | null>(null)
  const [passwordStrength, setPasswordStrength] = useState<0 | 1 | 2 | 3 | 4>(0)

  // Handle already authenticated users
  if (user && !authLoading) {
    return (
      <motion.div
        variants={pageVariants}
        initial="initial"
        animate="animate"
        className="relative min-h-screen overflow-hidden flex items-center justify-center bg-[radial-gradient(ellipse_at_center,#9edfc1_0%,#b5e7d0_40%,#dcf2e8_74%,#effaf4_100%)] px-4 py-12">
        <div className="w-full max-w-md">
          <Card className="w-full">
            <CardHeader className="text-center">
              <CardTitle className="text-2xl font-bold flex items-center justify-center gap-2 text-gray-900">
                <CheckCircle2 className="h-6 w-6 text-aura-accent" />
                Already Signed In
              </CardTitle>
              <CardDescription>Welcome back, {user.full_name?.split(" ")[0] || "Clinician"}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-center text-aura-muted">
                <p>You are already logged in to your AURA-Dx account.</p>
                <p className="text-sm mt-1">Role: {(user.role || "").replace("_", " ").replace(/\b\w/g, c => c.toUpperCase())}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  className="flex-1 gap-2"
                  onClick={() => navigate("/dashboard")}
                >
                  <ArrowRight className="h-4 w-4" />
                  Go to Dashboard
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={async () => {
                    await signOut()
                    navigate("/login")
                  }}
                >
                  Sign Out
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </motion.div>
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { error: signInError, accountStatus } = await signIn(email, password)
    if (signInError) {
      setError(signInError.message)
      setLoading(false)
      return
    }

    if (accountStatus) {
      setStatusDialog({ type: accountStatus as "pending" | "approved" | "rejected" | "deleted" | "unregistered" })
      setLoading(false)
      return
    }

    navigate("/dashboard")
  }

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setForgotLoading(true)
    setForgotMessage(null)

    const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    })

    if (error) {
      setForgotMessage(error.message)
      setForgotLoading(false)
      return
    }

    setForgotMessage("If an account exists for this email, a password reset link has been sent.")
    setForgotLoading(false)
  }

  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      className="relative min-h-screen overflow-hidden flex items-center justify-center bg-[radial-gradient(ellipse_at_center,#9edfc1_0%,#b5e7d0_40%,#dcf2e8_74%,#effaf4_100%)] px-4 py-12">
      <div className="relative z-10 w-full max-w-md">
        <Link
          to="/"
          aria-label="Back to Website"
          title="Back to Website"
          className="mb-4 flex h-10 w-10 items-center justify-center rounded-full border border-aura-border bg-white text-aura-accent shadow-aura-sm transition-all duration-200 hover:border-aura-accent-light hover:bg-white hover:text-aura-accent-dark hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-accent focus-visible:ring-offset-2 focus-visible:ring-offset-aura-bg"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <Card className="w-full rounded-xl border-aura-border bg-white/70 shadow-lg backdrop-blur-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold text-gray-900">Welcome back</CardTitle>
          <CardDescription className="text-gray-700">Sign in to your AURA-Dx account</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div role="alert" className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email" className="text-gray-700">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@clinic.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                  className="h-10 bg-white/90"
                />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-gray-700">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    // Password strength calculation
                    const value = e.target.value
                    let strength = 0
                    if (value.length >= 8) strength++
                    if (/[A-Z]/.test(value)) strength++
                    if (/[a-z]/.test(value)) strength++
                    if (/[0-9]/.test(value)) strength++
                    if (/[!@#$%^&*(),.?"':{}|<>]/.test(value)) strength++
                    setPasswordStrength(strength as 0 | 1 | 2 | 3 | 4)
                  }}
                  required
                  disabled={loading}
                  className="h-10 bg-white/90 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-2.5 text-aura-muted transition-colors hover:text-aura-text"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
                </button>
              </div>
              {password && (
                <div className="space-y-1" role="progressbar" aria-valuenow={passwordStrength} aria-valuemin={0} aria-valuemax={4} aria-label="Password strength">
                  <div className="h-1.5 rounded-full overflow-hidden bg-aura-border-soft">
                    <div
                      className="h-full transition-all duration-300"
                      style={{
                        width: `${(passwordStrength / 4) * 100}%`,
                        backgroundColor:
                          passwordStrength <= 1 ? "var(--destructive)" :
                          passwordStrength === 2 ? "var(--color-aura-warning)" :
                          passwordStrength === 3 ? "var(--color-aura-warning)" :
                          "var(--color-aura-accent)",
                      }}
                    />
                  </div>
                  <p className="text-xs text-gray-700">
                    {passwordStrength === 0 ? "Very weak" :
                     passwordStrength === 1 ? "Weak" :
                     passwordStrength === 2 ? "Fair" :
                     passwordStrength === 3 ? "Good" :
                     "Strong"}
                  </p>
                </div>
              )}
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowForgotPassword(true)}
                  className="text-sm font-medium text-emerald-700 hover:text-emerald-800 hover:underline"
                >
                  Forgot password?
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full h-10 bg-emerald-700 text-white shadow-sm transition-colors duration-200 hover:bg-emerald-800 focus-visible:ring-emerald-600"
              disabled={loading}
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" role="status" aria-live="polite" />}
              {loading ? "Signing in…" : "Sign In"}
            </Button>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-aura-border-soft" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-white/70 px-2 text-gray-700">Or continue with</span>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-full h-10 gap-2"
              disabled={loading}
              onClick={async () => {
                setError(null)
                setLoading(true)
                try {
                  const { error } = await signInWithOAuth("google")
                  if (error) {
                    setError(error.message)
                  }
                } finally {
                  setLoading(false)
                }
              }}
            >
              <GoogleIcon className="h-4 w-4" />
              Continue with Google
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex justify-center">
          <p className="text-sm text-gray-700">
            Don't have an account?{" "}
            <Link
              to="/register"
              className="font-medium text-emerald-700 hover:text-emerald-800 hover:underline"
            >
              Register an Account
            </Link>
          </p>
        </CardFooter>
      </Card>
      </div>

      <Dialog open={statusDialog?.type === "pending"} onOpenChange={() => setStatusDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-aura-warning" />
              Account Pending Approval
            </DialogTitle>
            <DialogDescription className="pt-2">
              Your account is currently under review. An administrator will review your registration shortly. Please check back later or contact support if you have questions.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setStatusDialog(null)}>
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={statusDialog?.type === "rejected"} onOpenChange={() => setStatusDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-destructive" />
              Registration Declined
            </DialogTitle>
            <DialogDescription className="pt-2">
              Your account registration has been declined. If you believe this was an error or would like to appeal this decision, please contact our support team for further assistance.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setStatusDialog(null)}>
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={statusDialog?.type === "deleted"} onOpenChange={() => setStatusDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-destructive" />
              Account Deactivated
            </DialogTitle>
            <DialogDescription className="pt-2">
              This account has been deactivated and is no longer accessible. If you believe this action was taken in error, please contact our support team for further assistance.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setStatusDialog(null)}>
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={statusDialog?.type === "approved"} onOpenChange={() => setStatusDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-aura-accent" />
              Welcome Back
            </DialogTitle>
            <DialogDescription className="pt-2">
              Your account is active and approved. You now have full access to the AURA-Dx platform.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={async () => { await confirmLogin(); navigate("/dashboard") }}>
              Proceed to Dashboard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={statusDialog?.type === "unregistered"} onOpenChange={() => setStatusDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              Account Not Found
            </DialogTitle>
            <DialogDescription className="pt-2">
              No account exists with the provided credentials. Please verify your email address or register for a new account.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => { setStatusDialog(null); navigate("/register") }}>
              Register Now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showForgotPassword} onOpenChange={setShowForgotPassword}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-5 w-5 text-aura-accent" />
              Reset Password
            </DialogTitle>
            <DialogDescription className="pt-2">
              Enter your email address and we'll send you a link to reset your password.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleForgotPassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="forgot-email">Email</Label>
              <Input
                id="forgot-email"
                type="email"
                autoComplete="email"
                placeholder="you@clinic.com"
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                required
                disabled={forgotLoading}
                className="h-10"
              />
            </div>
            {forgotMessage && (
              <div className="text-sm" role="alert">
                <p className={forgotMessage.includes("sent") ? "text-aura-accent-dark" : "text-destructive"}>
                  {forgotMessage}
                </p>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setShowForgotPassword(false); setForgotEmail(""); setForgotMessage(null) }}>
                Cancel
              </Button>
              <Button type="submit" disabled={forgotLoading}>
                {forgotLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" role="status" aria-live="polite" />}
                {forgotLoading ? "Sending…" : "Send Reset Link"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}
