"use client"

import { useState, useEffect } from "react"
import { Link, useNavigate } from "react-router-dom"
import { motion } from "framer-motion"
import { pageVariants } from "@/lib/motion"
import { Loader2, AlertCircle, Eye, EyeOff, ShieldCheck, CheckCircle2, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
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
import { getApiUrl } from "@/lib/api"
import { GoogleIcon } from "@/components/GoogleIcon"

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
  const [passwordStrength, setPasswordStrength] = useState<0 | 1 | 2 | 3 | 4>(0)
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
              </div>
              <div className="flex gap-2">
                <Button className="flex-1 gap-2" onClick={() => navigate("/dashboard")}>
                  <ArrowRight className="h-4 w-4" />
                  Go to Dashboard
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => { window.location.href = "/login?logout=true" }}>
                  Sign Out
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </motion.div>
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
      let strength = 0
      if (value.length >= 8) strength++
      if (/[A-Z]/.test(value)) strength++
      if (/[a-z]/.test(value)) strength++
      if (/[0-9]/.test(value)) strength++
      if (/[!@#$%^&*(),.?"':{}|<>]/.test(value)) strength++
      setPasswordStrength(strength as 0 | 1 | 2 | 3 | 4)
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
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      className="relative min-h-screen overflow-hidden flex items-center justify-center bg-[radial-gradient(ellipse_at_center,#9edfc1_0%,#b5e7d0_40%,#dcf2e8_74%,#effaf4_100%)] px-4 py-12">
      <Card className="relative z-10 w-full max-w-md rounded-xl border-aura-border bg-white/70 shadow-lg backdrop-blur-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold text-gray-900">Create Account</CardTitle>
          <CardDescription className="text-gray-700">Register as a clinician to access AURA-Dx</CardDescription>
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
              <Label htmlFor="full_name" className="text-gray-700">Full Name</Label>
              <Input
                id="full_name"
                name="full_name"
                type="text"
                autoComplete="name"
                placeholder="Dr. John Smith"
                value={formData.full_name}
                onChange={handleChange}
                required
                disabled={loading}
                className="h-10 bg-white/90"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" className="text-gray-700">Email</Label>
              <div className="flex gap-2">
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@clinic.com"
                  value={formData.email}
                  onChange={handleChange}
                  required
                  disabled={loading || otpVerified}
                  className="h-10 flex-1 bg-white/90"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 flex-shrink-0"
                  disabled={loading || otpVerified || !isEmailValid || otpCooldown > 0}
                  onClick={requestOtp}
                >
                  {otpSending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : otpVerified ? (
                    <CheckCircle2 className="mr-2 h-4 w-4 text-aura-accent" />
                  ) : otpCooldown > 0 ? (
                    <span className="text-xs">{otpCooldown}s</span>
                  ) : (
                    "Send code"
                  )}
                </Button>
              </div>
            </div>

            {otpSent && !otpVerified && (
              <div className="space-y-2">
                <Label htmlFor="otp" className="text-gray-700">Verification Code</Label>
                <div className="flex gap-2">
                  <Input
                    id="otp"
                    name="otp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="6-digit code"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    disabled={loading || otpVerifying}
                    className="h-10 flex-1 bg-white/90 tracking-[0.3em] text-center"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 flex-shrink-0"
                    disabled={loading || otpVerifying || otpCode.length !== 6}
                    onClick={verifyOtp}
                  >
                    {otpVerifying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Verify
                  </Button>
                </div>
              </div>
            )}

            {(otpError || otpMessage) && (
              <div
                role="alert"
                className={
                  otpError
                    ? "flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-lg"
                    : "flex items-center gap-2 text-sm text-aura-accent bg-aura-sage/30 p-3 rounded-lg"
                }
              >
                {otpError ? <AlertCircle className="h-4 w-4 flex-shrink-0" /> : <CheckCircle2 className="h-4 w-4 flex-shrink-0" />}
                {otpError || otpMessage}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="phone" className="text-gray-700">Phone (optional)</Label>
              <Input
                id="phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                placeholder="+1 (555) 000-0000"
                value={formData.phone}
                onChange={handleChange}
                disabled={loading}
                className="h-10 bg-white/90"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="specialization" className="text-gray-700">Specialization (optional)</Label>
              <Input
                id="specialization"
                name="specialization"
                type="text"
                placeholder="Pulmonology, Internal Medicine, etc."
                value={formData.specialization}
                onChange={handleChange}
                disabled={loading}
                className="h-10 bg-white/90"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="license_number" className="text-gray-700">License Number (optional)</Label>
              <Input
                id="license_number"
                name="license_number"
                type="text"
                placeholder="Professional license number"
                value={formData.license_number}
                onChange={handleChange}
                disabled={loading}
                className="h-10 bg-white/90"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-gray-700">Password</Label>
              <p className="text-xs text-gray-700">At least 8 characters with uppercase, lowercase, number, and a special character</p>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={formData.password}
                  onChange={handleChange}
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
              {formData.password && (
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
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-gray-700">Confirm Password</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  required
                  disabled={loading}
                  className="h-10 bg-white/90 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-aura-muted hover:text-aura-text"
                  aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                >
                  {showConfirmPassword ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
                </button>
              </div>
              {formData.confirmPassword && formData.password !== formData.confirmPassword && (
                <p className="text-xs text-destructive">Passwords do not match</p>
              )}
            </div>

            <Button
              type="submit"
              className="w-full h-10 bg-emerald-700 text-white shadow-sm transition-colors duration-200 hover:bg-emerald-800 focus-visible:ring-emerald-600"
              disabled={loading || !canRegister}
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" role="status" aria-live="polite" />}
              {loading ? "Creating Account…" : "Create Account"}
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
                const { error } = await signInWithOAuth("google")
                if (error) {
                  setError(error.message)
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
            Already have an account?{" "}
            <Link
              to="/login"
              className="font-medium text-emerald-700 hover:text-emerald-800 hover:underline"
            >
              Sign in
            </Link>
          </p>
        </CardFooter>
      </Card>

      <Dialog open={showApprovalDialog} onOpenChange={() => { setShowApprovalDialog(false); navigate("/login") }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-aura-accent" />
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
    </motion.div>
  )
}
