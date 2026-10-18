"use client"

import { useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Key,
  Loader2,
  Lock,
  Mail,
  ShieldAlert,
  ShieldCheck,
  UserRound,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { AuthShell } from "@/components/auth/AuthShell"
import { AuthSwitchLink } from "@/components/auth/AuthSwitchLink"
import { AUTH_SECONDARY_BUTTON, AuthField, PasswordStrengthMeter } from "@/components/auth/AuthField"
import { PasswordToggle } from "@/components/auth/PasswordToggle"
import { authCardVariants, authFieldGroupVariants, authFieldVariants } from "@/components/auth/auth-motion"
import { useAuth } from "@/hooks/useAuth"
import { GoogleIcon } from "@/components/GoogleIcon"
import { StatusIndicator } from "@/components/StatusIndicator"
import { scorePassword, type PasswordStrengthLevel } from "@/lib/password-strength"
import { supabase } from "@/lib/supabase"

export function Login() {
  /* Kept as a single object rather than destructured, so the dev-only property
   name is referenced solely inside the `import.meta.env.DEV` branch below.
   Destructuring it here would run in every build and leave the name in dist. */
  const auth = useAuth()
  const { signIn, confirmLogin, signInWithOAuth, signOut, user, loading: authLoading } = auth
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
  const [passwordStrength, setPasswordStrength] = useState<PasswordStrengthLevel>(0)

  /* Framer Motion is JS-driven, so the project's global reduced-motion CSS
     reset does not reach it — the hook is the only thing gating these. */
  const reduced = useReducedMotion() ?? false

  /* An authenticated user who is not approved gets their own screen rather
     than a redirect.

     Previously this block only checked `user`, so a pending or rejected account
     signed in, landed here, was told "Already Signed In", tapped "Go to
     Dashboard", and PrivateRoute -- which requires status === "approved" --
     redirected straight back to /login. Tap, bounce, tap, bounce, with no way
     out but the browser's reload button. On a phone that reads as a frozen
     app.

     Each status now gets the screen that tells the truth about it, and only
     approved users are offered the dashboard. */
  if (user && !authLoading) {
    const status = user.status ?? "approved"
    const approved = status === "approved"

    const copy = {
      icon: approved ? CheckCircle2 : status === "pending" ? Clock : ShieldAlert,
      title: approved
        ? "Already Signed In"
        : status === "pending"
          ? "Awaiting Approval"
          : "Access Denied",
      tone: approved ? "text-aura-accent" : status === "pending" ? "text-amber-600" : "text-destructive",
      body: approved
        ? `You are already logged in to your AURA-Dx account.`
        : status === "pending"
          ? "Your account has been created and is waiting for an administrator to approve it. You will be able to sign in once that is done."
          : "Your account has not been approved for access to AURA-Dx. Please contact your administrator.",
    } as const

    const Icon = copy.icon

    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_center,#9edfc1_0%,#b5e7d0_40%,#dcf2e8_74%,#effaf4_100%)] px-4 py-12">
        <motion.div
          variants={authCardVariants}
          initial={reduced ? false : "hidden"}
          animate="visible"
          className="w-full max-w-md rounded-2xl border border-aura-border bg-white p-8 shadow-aura-xl"
        >
          <div className="flex flex-col items-center gap-3 text-center">
            <Icon className={`h-8 w-8 ${copy.tone}`} aria-hidden="true" />
            <h1 className="font-display text-2xl font-bold text-aura-text">{copy.title}</h1>
            <p className="text-aura-muted">
              {approved ? `Welcome back, ${user.full_name?.split(" ")[0] || "Clinician"}` : user.email}
            </p>
          </div>
          <div className="mt-6 space-y-1 text-center text-aura-muted">
            <p>{copy.body}</p>
            {approved && (
              <p className="text-sm">
                Role: {(user.role || "").replace("_", " ").replace(/\b\w/g, c => c.toUpperCase())}
              </p>
            )}
          </div>
          <div className="mt-7 flex gap-2">
            {approved && (
              <Button
                className="flex-1 gap-2"
                onClick={() => navigate("/dashboard")}
              >
                <ArrowRight className="h-4 w-4" />
                Go to Dashboard
              </Button>
            )}
            <Button
              variant={approved ? "outline" : "default"}
              className={approved ? "flex-1" : "w-full"}
              onClick={async () => {
                await signOut()
                navigate("/login")
              }}
            >
              Sign Out
            </Button>
          </div>
        </motion.div>
      </div>
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
    <>
      <AuthShell
        brand={
          <>
            <h1 className="font-display text-xl font-bold tracking-tight text-white sm:text-2xl md:text-4xl md:leading-[1.08]">
              Welcome back
            </h1>
            {/* `md:text-lg` rather than an arbitrary rem: the hardcoded value
                bypassed the app-wide type scale, so this line stayed small while
                everything around it grew. max-w widened to use the brand
                column's actual measure instead of wrapping at 26ch. */}
            <p className="hidden max-w-[34ch] text-base leading-relaxed text-white/90 md:block md:text-lg">
              Acoustic unit for respiratory assessment
            </p>
          </>
        }
      >
        {/* Availability.

            Inset from the panel's corner by the panel's own padding rather than
            pinned to it. `right-0 top-0` resolves against the padding box, so it
            sat flush against the card border and read as a stray label rather
            than part of the form. `sm:right-8` / `md:right-10` line it up with
            the input fields below it at both breakpoints.

            `sm:top-6` rather than `sm:top-10`: the panel is two lines tall now,
            so sitting it on the content edge put the second line on top of the
            first field.

            In flow below `sm`: absolutely positioning it on a 375px screen
            puts it on top of the first field rather than beside it. */}
        <StatusIndicator className="mb-5 sm:absolute sm:right-8 sm:top-6 sm:mb-0 md:right-10" />

        {/* The form owns the shake transform, so the field stagger lives on an
            inner wrapper — two transform sources on one element fight. */}
        <motion.form
          onSubmit={handleSubmit}
          animate={reduced || !error ? undefined : { x: [0, -7, 7, -4, 4, 0] }}
          transition={{ duration: 0.3, ease: "easeInOut" }}
        >
          <motion.div
            variants={authFieldGroupVariants}
            initial={reduced ? false : "hidden"}
            animate="visible"
            className="flex flex-col gap-5"
          >
            <motion.div variants={authFieldVariants}>
              <AuthField
                id="email"
                name="email"
                label="Email"
                icon={Mail}
                type="email"
                autoComplete="email"
                placeholder="you@clinic.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
              />
            </motion.div>

            <motion.div variants={authFieldVariants} className="flex flex-col gap-2">
              <AuthField
                id="password"
                name="password"
                label="Password"
                icon={Lock}
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setPasswordStrength(scorePassword(e.target.value))
                }}
                required
                disabled={loading}
                trailing={<PasswordToggle visible={showPassword} onToggle={() => setShowPassword(!showPassword)} />}
                footer={
                  <>
                    {password && <PasswordStrengthMeter strength={passwordStrength} />}
                    <div className="flex justify-end pt-0.5">
                      <button
                        type="button"
                        onClick={() => setShowForgotPassword(true)}
                        className="rounded-sm text-sm font-medium text-aura-forest underline-offset-4 transition-colors duration-200 hover:text-aura-forest-light hover:underline focus-visible:outline-none focus-visible:underline"
                      >
                        Forgot password?
                      </button>
                    </div>
                  </>
                }
              />
            </motion.div>

            <motion.div variants={authFieldVariants}>
              {/* `aura-sheen` supplies the single diagonal sweep on hover,
                  guarded to hover-capable pointers so touch never sticks. */}
              <motion.button
                type="submit"
                disabled={loading}
                whileHover={reduced ? undefined : { y: -1 }}
                whileTap={reduced ? undefined : { scale: 0.98 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
                className="aura-sheen relative flex h-11 w-full items-center justify-center overflow-hidden rounded-lg bg-aura-forest px-4 text-sm font-semibold text-white shadow-aura-md transition-shadow duration-200 hover:shadow-aura-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-forest focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <span className="relative z-10 flex items-center justify-center gap-2">
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" role="status" aria-live="polite" />
                      <span>Signing in…</span>
                    </>
                  ) : (
                    <span>Sign In</span>
                  )}
                </span>
              </motion.button>
            </motion.div>

            <motion.div variants={authFieldVariants} className="flex items-center gap-3">
              <span aria-hidden="true" className="h-px flex-1 bg-aura-border" />
              <span className="text-xs font-medium uppercase tracking-[0.14em] text-aura-muted">
                Or continue with
              </span>
              <span aria-hidden="true" className="h-px flex-1 bg-aura-border" />
            </motion.div>

            <motion.div variants={authFieldVariants}>
              <motion.button
                type="button"
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
                whileHover={reduced ? undefined : { y: -1 }}
                whileTap={reduced ? undefined : { scale: 0.99 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
                className={AUTH_SECONDARY_BUTTON + " w-full"}
              >
                <GoogleIcon className="h-4 w-4" />
                Continue with Google
              </motion.button>
            </motion.div>

            <motion.div variants={authFieldVariants}>
              <AuthSwitchLink
                icon={UserRound}
                prompt="Don't have an account?"
                action="Register an Account"
                to="/register"
              />
            </motion.div>
          </motion.div>
        </motion.form>

        {/* Error sits below the form, announced as soon as it appears. */}
        <AnimatePresence initial={false}>
          {error && (
            <motion.div
              key="login-error"
              role="alert"
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="mt-5 flex items-start gap-2.5 rounded-lg border border-destructive/25 bg-destructive/10 p-3.5 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </AuthShell>

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
                className="h-11"
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
    </>
  )
}