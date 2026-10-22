"use client"

import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import {
  AlertCircle,
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  Hash,
  Loader2,
  Lock,
  LockKeyhole,
  LogIn,
  Mail,
  Phone,
  ShieldCheck,
  Stethoscope,
  User,
} from "lucide-react"
import { Button } from "@/components/ui/button"
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
import {
  authCardVariants,
  authFieldGroupDenseVariants,
  authFieldVariants,
} from "@/components/auth/auth-motion"
import { useAuth } from "@/hooks/useAuth"
import { getApiUrl } from "@/lib/api"
import { GoogleIcon } from "@/components/GoogleIcon"
import { scorePassword, type PasswordStrengthLevel } from "@/lib/password-strength"

export function Register() {
  const { signUp, signInWithOAuth, user, loading: authLoading } = useAuth()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  const [formData, setFormData] = useState({
    full_name: "",
    email: "",
    password: "",
    confirmPassword: "",
    phone: "",
    specialization: "",
    license_number: "",
  })
  const [passwordStrength, setPasswordStrength] = useState<PasswordStrengthLevel>(0)
  const [showApprovalDialog, setShowApprovalDialog] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [showErrorDialog, setShowErrorDialog] = useState(false)
  const [errorMessage, setErrorMessage] = useState("")

  // Email verification OTP
  const [otpSent, setOtpSent] = useState(false)
  const [otpCode, setOtpCode] = useState("")
  const [otpVerified, setOtpVerified] = useState(false)
  const [verifiedEmail, setVerifiedEmail] = useState("")
  const [otpSending, setOtpSending] = useState(false)
  const [otpVerifying, setOtpVerifying] = useState(false)
  const [otpError, setOtpError] = useState<string | null>(null)
  const [otpMessage, setOtpMessage] = useState<string | null>(null)
  const [otpCooldown, setOtpCooldown] = useState(0)

  // Cooldown timer for the "Send code" button (placed before any early return)
  useEffect(() => {
    if (otpCooldown <= 0) return
    const t = setTimeout(() => setOtpCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [otpCooldown])

  /* Framer Motion is JS-driven, so the project's global reduced-motion CSS
     reset does not reach it — the hook is the only thing gating these. */
  const reduced = useReducedMotion() ?? false

  if (user && !authLoading) {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_center,#9edfc1_0%,#b5e7d0_40%,#dcf2e8_74%,#effaf4_100%)] px-4 py-12">
        <motion.div
          variants={authCardVariants}
          initial={reduced ? false : "hidden"}
          animate="visible"
          className="w-full max-w-md rounded-2xl border border-aura-border bg-white p-8 shadow-aura-xl"
        >
          <div className="flex flex-col items-center gap-3 text-center">
            <CheckCircle2 className="h-8 w-8 text-aura-pine" aria-hidden="true" />
            <h1 className="font-display text-2xl font-bold text-aura-text">Already Signed In</h1>
            <p className="text-aura-muted">Welcome back, {user.full_name?.split(" ")[0] || "Clinician"}</p>
          </div>
          <div className="mt-6 text-center text-aura-muted">
            <p>You are already logged in to your AURA-Dx account.</p>
          </div>
          <div className="mt-7 flex gap-2">
            <Button className="flex-1 gap-2" onClick={() => navigate("/dashboard")}>
              <ArrowRight className="h-4 w-4" />
              Go to Dashboard
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => { window.location.href = "/login?logout=true" }}>
              Sign Out
            </Button>
          </div>
        </motion.div>
      </div>
    )
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
    setError(null)

    if (name === "email") {
      const next = value.trim().toLowerCase()
      if (next !== verifiedEmail) {
        setOtpSent(false)
        setOtpCode("")
        setOtpVerified(false)
        setVerifiedEmail("")
        setOtpError(null)
        setOtpMessage(null)
      }
    }

    if (name === "password") {
      setPasswordStrength(scorePassword(value))
    }
  }

  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())

  const requestOtp = async () => {
    setOtpError(null)
    setOtpMessage(null)
    const email = formData.email.trim().toLowerCase()
    if (!isEmailValid) {
      setOtpError("Enter a valid email address first")
      return
    }
    setOtpSending(true)
    try {
      const res = await fetch(getApiUrl("/api/auth/send-otp"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) {
        setOtpError(data.detail || "Failed to send verification code")
        return
      }
      setOtpSent(true)
      setOtpMessage("We sent a 6-digit code to your email. Check your inbox (and spam).")
      if (data.dev_code) {
        console.log("[dev] email OTP code:", data.dev_code)
        setOtpMessage(`We sent a 6-digit code to your email. (Dev code: ${data.dev_code})`)
      }
      setOtpCooldown(30)
    } catch (e) {
      setOtpError(e instanceof Error ? e.message : "Network error sending code")
    } finally {
      setOtpSending(false)
    }
  }

  const verifyOtp = async () => {
    setOtpError(null)
    setOtpMessage(null)
    const email = formData.email.trim().toLowerCase()
    setOtpVerifying(true)
    try {
      const res = await fetch(getApiUrl("/api/auth/verify-otp"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: otpCode }),
      })
      const data = await res.json()
      if (!res.ok) {
        setOtpError(data.detail || "Invalid code")
        return
      }
      setOtpVerified(true)
      setVerifiedEmail(email)
      setOtpMessage("Email verified successfully.")
    } catch (e) {
      setOtpError(e instanceof Error ? e.message : "Network error verifying code")
    } finally {
      setOtpVerifying(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitted) return
    setError(null)

    if (formData.password !== formData.confirmPassword) {
      setError("Passwords do not match")
      return
    }

    if (!emailVerifiedOk) {
      setError("Please verify your email with the 6-digit code before creating an account")
      return
    }

    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?"':{}|<>]).{8,}$/
    if (!passwordRegex.test(formData.password)) {
      setError("Password must be at least 8 characters with uppercase, lowercase, number, and special character")
      return
    }

    setSubmitted(true)
    setLoading(true)
    const { error: signUpError, autoApproved } = await signUp({
      email: formData.email,
      password: formData.password,
      full_name: formData.full_name,
      role: "clinician",
      phone: formData.phone || undefined,
      specialization: formData.specialization || undefined,
      license_number: formData.license_number || undefined,
    })

    if (signUpError) {
      let friendlyMessage = signUpError.message
      const lowerMsg = signUpError.message.toLowerCase()
      if (lowerMsg.includes("already registered") ||
          lowerMsg.includes("already exists") ||
          lowerMsg.includes("duplicate") ||
          lowerMsg.includes("user already") ||
          lowerMsg.includes("email already")) {
        friendlyMessage = "An account with this email already exists. Please sign in instead."
      }
      setErrorMessage(friendlyMessage)
      setShowErrorDialog(true)
      setLoading(false)
      setSubmitted(false)
      return
    }

    setLoading(false)
    if (autoApproved) {
      navigate("/dashboard")
      return
    }
    setShowApprovalDialog(true)
  }

  const emailVerifiedOk = otpVerified && verifiedEmail === formData.email.trim().toLowerCase()

  const canRegister =
    !!formData.email &&
    !!formData.full_name &&
    !!formData.password &&
    passwordStrength >= 3 &&
    formData.password === formData.confirmPassword &&
    emailVerifiedOk

  return (
    <>
      <AuthShell
        wideForm
        brand={
          <>
            <h1 className="font-display text-xl font-bold tracking-tight text-white md:text-4xl md:leading-[1.08]">
              Create your account
            </h1>
            {/* Matches Login: scale-aware `md:text-lg` instead of a hardcoded rem,
                and the brand column's real measure instead of 26ch. */}
            <p className="hidden max-w-[34ch] text-base leading-relaxed text-white/90 md:block md:text-lg">
              Acoustic unit for respiratory assessment
            </p>
          </>
        }
      >
        {/* The form owns the shake transform, so the field stagger lives on an
            inner wrapper — two transform sources on one element fight. */}
        <motion.form
          onSubmit={handleSubmit}
          animate={reduced || !error ? undefined : { x: [0, -7, 7, -4, 4, 0] }}
          transition={{ duration: 0.3, ease: "easeInOut" }}
        >
          {/* Two columns from `lg` up, where the form column is wide enough for
              each paired field to still hold a full phone number or licence
              number. Below that the columns would squeeze to ~190px, so the
              grid stays single-column.

              Only Phone and Licence Number are paired — both are short strings,
              and 240px holds either in full. Names and specialisations can run
              much longer, so they keep the full column width rather than
              scrolling horizontally. The required fields are also kept
              contiguous, with the three optional ones trailing them. */}
          <motion.div
            variants={authFieldGroupDenseVariants}
            initial={reduced ? false : "hidden"}
            animate="visible"
            className="grid grid-cols-1 gap-3 lg:grid-cols-2"
          >
            <motion.div variants={authFieldVariants} className="lg:col-span-2">
              <AuthField
                id="full_name"
                name="full_name"
                label="Full Name"
                icon={User}
                type="text"
                autoComplete="name"
                placeholder="Dr. Juan Dela Cruz"
                value={formData.full_name}
                onChange={handleChange}
                required
                disabled={loading}
              />
            </motion.div>

            <motion.div variants={authFieldVariants} className="lg:col-span-2">
              <AuthField
                id="email"
                name="email"
                label="Email"
                icon={Mail}
                type="email"
                autoComplete="email"
                placeholder="you@clinic.com"
                value={formData.email}
                onChange={handleChange}
                required
                disabled={loading || otpVerified}
                aside={
                  <button
                    type="button"
                    className={AUTH_SECONDARY_BUTTON + " min-w-[7.5rem] shrink-0"}
                    disabled={loading || otpVerified || !isEmailValid || otpCooldown > 0}
                    onClick={requestOtp}
                  >
                    {otpSending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : otpVerified ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 text-aura-pine" />
                        <span>Sent</span>
                      </>
                    ) : otpCooldown > 0 ? (
                      <span className="text-xs">Resend in {otpCooldown}s</span>
                    ) : (
                      <span>Send code</span>
                    )}
                  </button>
                }
              />
            </motion.div>

            {otpSent && !otpVerified && (
              <motion.div variants={authFieldVariants} className="lg:col-span-2">
                <AuthField
                  id="otp"
                  name="otp"
                  label="Verification Code"
                  icon={Hash}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="6-digit code"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  disabled={loading || otpVerifying}
                  inputClassName="pr-4 text-center font-mono tracking-[0.3em]"
                  aside={
                    <button
                      type="button"
                      className={AUTH_SECONDARY_BUTTON + " shrink-0"}
                      disabled={loading || otpVerifying || otpCode.length !== 6}
                      onClick={verifyOtp}
                    >
                      {otpVerifying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Verify
                    </button>
                  }
                />
              </motion.div>
            )}

            {(otpError || otpMessage) && (
              <motion.div
                variants={authFieldVariants}
                className="lg:col-span-2"
                role="alert"
              >
                <div
                  className={
                    otpError
                      ? "flex items-start gap-2.5 rounded-lg border border-destructive/25 bg-destructive/10 p-3.5 text-sm text-destructive"
                      : "flex items-start gap-2.5 rounded-lg border border-aura-border bg-aura-sage/40 p-3.5 text-sm text-aura-pine"
                  }
                >
                  {otpError ? (
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  )}
                  <span>{otpError || otpMessage}</span>
                </div>
              </motion.div>
            )}

            <motion.div variants={authFieldVariants} className="lg:col-span-2">
              <AuthField
                id="password"
                name="password"
                label="Password"
                icon={Lock}
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="••••••••"
                value={formData.password}
                onChange={handleChange}
                required
                disabled={loading}
                trailing={<PasswordToggle visible={showPassword} onToggle={() => setShowPassword(!showPassword)} />}
                /* Rules and meter share a row — stacking them cost an extra
                   line of height for no added information. The copy is kept
                   short enough to stay on one line beside the meter; the full
                   requirement is enforced on submit regardless. */
                footer={
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                    <p className="text-xs leading-snug text-aura-muted">
                      8+ characters with upper, lower, a number, and a symbol
                    </p>
                    {formData.password && (
                      <PasswordStrengthMeter strength={passwordStrength} className="w-28 shrink-0" />
                    )}
                  </div>
                }
              />
            </motion.div>

            <motion.div variants={authFieldVariants} className="lg:col-span-2">
              <AuthField
                id="confirmPassword"
                name="confirmPassword"
                label="Confirm Password"
                icon={LockKeyhole}
                type={showConfirmPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="••••••••"
                value={formData.confirmPassword}
                onChange={handleChange}
                required
                disabled={loading}
                trailing={
                  <PasswordToggle
                    visible={showConfirmPassword}
                    onToggle={() => setShowConfirmPassword(!showConfirmPassword)}
                  />
                }
                footer={
                  formData.confirmPassword && formData.password !== formData.confirmPassword ? (
                    <p className="text-xs text-destructive">Passwords do not match</p>
                  ) : null
                }
              />
            </motion.div>

            {/* The three optional details trail the required fields. Phone and
                Licence Number pair up — both are short enough for half the
                column. Specialisation takes the full width because it can run
                to several words. */}
            <motion.div variants={authFieldVariants}>
              <AuthField
                id="phone"
                name="phone"
                label="Phone (optional)"
                icon={Phone}
                type="tel"
                autoComplete="tel"
                placeholder="+63 917 000 0000"
                value={formData.phone}
                onChange={handleChange}
                disabled={loading}
              />
            </motion.div>

            <motion.div variants={authFieldVariants}>
              <AuthField
                id="license_number"
                name="license_number"
                label="License Number (optional)"
                icon={BadgeCheck}
                type="text"
                placeholder="PRC 1234567"
                value={formData.license_number}
                onChange={handleChange}
                disabled={loading}
              />
            </motion.div>

            <motion.div variants={authFieldVariants} className="lg:col-span-2">
              <AuthField
                id="specialization"
                name="specialization"
                label="Specialization (optional)"
                icon={Stethoscope}
                type="text"
                placeholder="e.g. Pulmonology, Internal Medicine"
                value={formData.specialization}
                onChange={handleChange}
                disabled={loading}
              />
            </motion.div>

            <motion.div variants={authFieldVariants} className="lg:col-span-2">
              {/* `aura-sheen` supplies the single diagonal sweep on hover,
                  guarded to hover-capable pointers so touch never sticks. */}
              <motion.button
                type="submit"
                disabled={loading || !canRegister}
                whileHover={reduced ? undefined : { y: -1 }}
                whileTap={reduced ? undefined : { scale: 0.98 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
                className="aura-sheen relative flex h-11 w-full items-center justify-center overflow-hidden rounded-lg bg-aura-forest px-4 text-sm font-semibold text-white shadow-aura-md transition-shadow duration-200 lg:hover:shadow-aura-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-forest focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <span className="relative z-10 flex items-center justify-center gap-2">
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" role="status" aria-live="polite" />
                      <span>Creating Account…</span>
                    </>
                  ) : (
                    <span>Create Account</span>
                  )}
                </span>
              </motion.button>
            </motion.div>

            <motion.div variants={authFieldVariants} className="flex items-center gap-3 lg:col-span-2">
              <span aria-hidden="true" className="h-px flex-1 bg-aura-border" />
              <span className="text-xs font-medium uppercase tracking-[0.14em] text-aura-muted">
                Or continue with
              </span>
              <span aria-hidden="true" className="h-px flex-1 bg-aura-border" />
            </motion.div>

            <motion.div variants={authFieldVariants} className="lg:col-span-2">
              <motion.button
                type="button"
                disabled={loading}
                onClick={async () => {
                  setError(null)
                  setLoading(true)
                  const { error } = await signInWithOAuth("google")
                  if (error) {
                    setError(error.message)
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

            {/* Mirrors Login's switch line, closing the form the same way. */}
            <motion.div variants={authFieldVariants} className="lg:col-span-2">
              <AuthSwitchLink
                icon={LogIn}
                prompt="Already have an account?"
                action="Sign in"
                to="/login"
              />
            </motion.div>
          </motion.div>
        </motion.form>

        {/* Error sits below the form, announced as soon as it appears. */}
        <AnimatePresence initial={false}>
          {error && (
            <motion.div
              key="register-error"
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

      <Dialog open={showApprovalDialog} onOpenChange={() => { setShowApprovalDialog(false); navigate("/login") }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-aura-pine" />
              Registration Submitted
            </DialogTitle>
            <DialogDescription className="pt-2">
              Your email was verified and your account was created as a <span className="font-medium text-aura-ink">Clinician</span> — it is now <span className="font-medium text-aura-ink">pending approval</span>. An admin or the super admin must approve it from User Management before you can sign in. You'll be notified once approved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => { setShowApprovalDialog(false); navigate("/login") }}>
              Back to Login
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showErrorDialog} onOpenChange={() => { setShowErrorDialog(false); navigate("/login") }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              Registration Failed
            </DialogTitle>
            <DialogDescription className="pt-2">
              {errorMessage}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => { setShowErrorDialog(false); navigate("/login") }}>
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}