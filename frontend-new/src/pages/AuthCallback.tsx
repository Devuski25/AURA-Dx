"use client"

import { useState, useEffect, useRef } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { motion } from "framer-motion"
import { pageVariants } from "@/lib/motion"
import { Loader2, CheckCircle, AlertCircle, ArrowRight, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"
import { useAuth } from "@/hooks/useAuth"
import { supabase } from "@/lib/supabase"
import { getApiUrl } from "@/lib/api"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/**
 * Turn the provider's error string into something a person can act on.
 *
 * Supabase hands back GoTrue's own wording ("User is banned", "Signups not
 * allowed for this instance", ...). Echoing it produces a screen that names an
 * internal state and tells the reader nothing about what to do next.
 */
function describeOAuthError(code: string | null, description: string | null): string {
  const raw = `${code ?? ""} ${description ?? ""}`.toLowerCase()
  if (raw.includes("banned") || raw.includes("disabled") || raw.includes("blocked")) {
    return "This account has been removed and can no longer sign in. If you believe this is a mistake, email supportauradx@gmail.com."
  }
  if (raw.includes("signup") || raw.includes("not allowed") || raw.includes("not found")) {
    return "No AURA-Dx account is linked to that Google account. It may have been removed by an administrator. You can register for a new account."
  }
  if (raw.includes("access_denied")) {
    return "Google sign-in was cancelled."
  }
  return description || "Authentication failed. Please try again."
}

export function AuthCallback() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { signIn, user, loading: authLoading, confirmLogin } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [accountStatus, setAccountStatus] = useState<"pending" | "rejected" | "deleted" | null>(null)
  const callbackStartedRef = useRef(false)

  useEffect(() => {
    // Guard against infinite re-runs: only execute once per mount
    if (callbackStartedRef.current) return
    callbackStartedRef.current = true

    const handleCallback = async () => {
      // If already authenticated, redirect to dashboard
      if (user) {
        navigate("/dashboard")
        return
      }

      const code = searchParams.get("code")
      const errorParam = searchParams.get("error")
      const errorDescription = searchParams.get("error_description")

      if (errorParam) {
        setError(describeOAuthError(errorParam, errorDescription))
        setLoading(false)
        return
      }

      try {
        if (code) {
          // Authorization code flow (legacy/non-PKCE)
          const { error: sessionError } = await supabase.auth.exchangeCodeForSession(code)
          if (sessionError) throw sessionError

          await checkProfileAndRedirect()
        } else {
          // PKCE flow — tokens in URL fragment, Supabase client parses automatically
          // Wait for session to be established via onAuthStateChange
          await waitForSession()
        }
      } catch (err) {
        console.error("[AuthCallback] Exception:", err)
        setError(err instanceof Error ? err.message : "Failed to complete sign in")
      } finally {
        setLoading(false)
      }
    }

    /* Remove the empty account a Google sign-in just created, then sign out.
       Best effort on purpose: the person is about to be told "no account",
       and a failed cleanup must not turn that into a different error. */
    const discardOAuthSignup = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (session) {
          await fetch(getApiUrl("/api/auth/discard-oauth-signup"), {
            method: "POST",
            headers: { Authorization: `Bearer ${session.access_token}` },
          })
        }
      } catch (err) {
        console.error("[AuthCallback] Could not discard the empty account:", err)
      }
      await supabase.auth.signOut()
    }

    const checkProfileAndRedirect = async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser()

      if (!authUser) {
        // No authenticated session — genuine failure. Do NOT look up by email
        // from URL params (account-enumeration risk).
        setError("Authentication timed out. Please try again.")
        return
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("status, role, last_login_at, clinic_name")
        .eq("id", authUser.id)
        .single()

      if (profile) {
        /* A Google identity that arrives pending with no clinic name is a
           brand-new auth user, not a registration. The Register page asks for
           a clinic name, so a pending profile without one cannot have come
           from there -- it is either someone tapping "Continue with Google"
           at random, or a removed account whose Google sign-in was recreated
           by Supabase. Either way there is nothing here to approve into a
           usable account, and leaving it in the admin queue is noise. */
        const isGoogle = authUser.app_metadata?.provider === "google"
        if (isGoogle && profile.status === "pending" && !profile.clinic_name) {
          await discardOAuthSignup()
          navigate("/login?status=unregistered", { replace: true })
          return
        }
        return handleProfileStatus(profile)
      }

      // Profile is null — either not found (PGRST116) or query error
      const isNotFound = !profileError || profileError.code === "PGRST116" || profileError.message?.includes("not found")

      if (!isNotFound) {
        // Genuine access error (RLS, auth, etc.) — not a missing profile
        console.error("[AuthCallback] Profile query error:", profileError)
        setError("Unable to access your account. Please try again or contact support.")
        await supabase.auth.signOut()
        return
      }

      /* No profile for this identity: the account is gone (removed by an
         administrator, or never created here).

         It used to insert a fresh pending profile as a fallback for "the
         trigger may not fire for OAuth". That fallback is why a deleted
         account came back as an approvable stranger, and it hid real
         deletion behind a row nobody meant to create. The trigger is in
         place and tested, so a missing profile now means exactly one
         thing. */
      await supabase.auth.signOut()
      navigate("/login?status=unregistered", { replace: true })
    }

    const handleProfileStatus = async (profile: { status: string; role?: string; last_login_at?: string | null }) => {
      if (profile.status === "pending") {
        // Friendly, non-error message shown directly on the callback page
        setAccountStatus("pending")
        setLoading(false)
        return
      }
      if (profile.status === "rejected" || profile.status === "deleted") {
        await supabase.auth.signOut()
        navigate(`/login?status=${profile.status}`, { replace: true })
        return
      }
      // status === "approved"
      if (profile.last_login_at === null || profile.last_login_at === undefined) {
        if (profile.role && profile.role !== "super_admin") {
          setSuccess(true)
          setLoading(false)
          return
        }
      }
      setSuccess(true)
      setLoading(false)
    }

    const waitForSession = async () => {
      // Poll for session (Supabase persists the PKCE session after redirect)
      // Give it up to ~10s, then retry once — network/provider redirects can be slow
      const attempts = [{ count: 50, delay: 200 }, { count: 50, delay: 200 }]
      for (const attempt of attempts) {
        for (let i = 0; i < attempt.count; i++) {
          const { data: { session } } = await supabase.auth.getSession()
          if (session?.user) {
            await checkProfileAndRedirect()
            return
          }
          await new Promise(r => setTimeout(r, attempt.delay))
        }
      }
      // Fallback: check for user directly
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (authUser) {
        await checkProfileAndRedirect()
      } else {
        setError("Authentication timed out. Please try again.")
      }
    }

    handleCallback()
  }, [searchParams, navigate, user])

  const goToDashboard = async () => {
    // Ensure backend token is exchanged before navigating to dashboard
    await supabase.auth.getSession()
    await confirmLogin()
    navigate("/dashboard")
  }

  const goToLogin = () => {
    navigate("/login")
  }

  if (loading || authLoading) {
    return (
      <motion.div
        variants={pageVariants}
        initial="initial"
        animate="animate"
        className="min-h-screen flex items-center justify-center bg-aura-surface px-4 py-12"
      >
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-aura-pine" role="status" aria-live="polite" />
          <p className="text-aura-text">Completing sign in...</p>
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      className="min-h-screen flex items-center justify-center bg-aura-surface px-4 py-12"
    >
      <div className="w-full max-w-md">
        <Card className="w-full">
          <CardHeader className="text-center">
            {accountStatus === "pending" ? (
              <>
                <Clock className="h-12 w-12 text-aura-warning-strong mx-auto mb-4" />
                <CardTitle className="text-2xl font-bold">Account Pending Approval</CardTitle>
                <CardDescription>
                  Your account registration is under review. An administrator will approve it shortly.
                </CardDescription>
              </>
            ) : error ? (
              <>
                <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
                <CardTitle className="text-2xl font-bold">Sign In Failed</CardTitle>
                <CardDescription>{error}</CardDescription>
              </>
            ) : success ? (
              <>
                <CheckCircle className="h-12 w-12 text-aura-pine mx-auto mb-4" />
                <CardTitle className="text-2xl font-bold">Welcome!</CardTitle>
                <CardDescription>Successfully signed in with Google</CardDescription>
              </>
            ) : (
              <>
                <Loader2 className="h-12 w-12 text-aura-pine mx-auto mb-4 animate-spin" role="status" aria-live="polite" />
                <CardTitle className="text-2xl font-bold">Processing...</CardTitle>
                <CardDescription>Please wait while we complete your sign in</CardDescription>
              </>
            )}
          </CardHeader>
          <CardContent />
          <CardFooter className="flex flex-col gap-2">
            {success && (
              <Button onClick={goToDashboard} className="w-full">
                <ArrowRight className="mr-2 h-4 w-4" />
                Continue to Dashboard
              </Button>
            )}
            {accountStatus === "pending" && (
              <Button variant="outline" onClick={goToLogin} className="w-full">
                Back to Login
              </Button>
            )}
            {error && (
              <Button variant="outline" onClick={goToLogin} className="w-full">
                Back to Login
              </Button>
            )}
          </CardFooter>
        </Card>
      </div>
    </motion.div>
  )
}