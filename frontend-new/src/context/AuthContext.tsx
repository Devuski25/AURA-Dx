"use client"

import { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from "react"
import { supabase } from "@/lib/supabase"
import type { User } from "@supabase/supabase-js"

interface Profile {
  id: string
  email: string
  full_name: string
  role: "clinician" | "admin" | "super_admin"
  status: "pending" | "approved" | "rejected" | "deleted"
  clinic_id: string | null
  phone: string | null
  specialization: string | null
  license_number: string | null
  last_login_at: string | null
  created_at: string
  updated_at: string
  avatar_url: string | null
}

interface AuthContextType {
  user: Profile | null
  loading: boolean
  accessToken: string | null
  signIn: (email: string, password: string) => Promise<{ error: Error | null; accountStatus?: "approved" | "pending" | "rejected" | "deleted" }>
  signUp: (data: {
    email: string
    password: string
    full_name: string
    role: "clinician" | "admin"
    phone?: string
    specialization?: string
    license_number?: string
  }) => Promise<{ error: Error | null; autoApproved?: boolean }>
  signInWithOAuth: (provider: "google") => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  refreshUser: () => Promise<void>
  confirmLogin: () => Promise<void>
  /** Dev builds only — see the dev role preview note below. */
  devPreviewSignIn: (role: DevRole) => void
  /** Dev builds only — clears the preview so the real login form returns. */
  devPreviewExit: () => void
}

/* ─── Dev role preview ─────────────────────────────────────────────────────
   Seeds a local, in-memory profile so both role-gated sides of the app can be
   reviewed without a live Supabase instance.

   It deliberately does NOT touch `signIn` and never inspects a password, so
   there is no path here that authenticates anybody. Nothing is persisted
   beyond `sessionStorage`, nothing is sent to Supabase, and it is gated on
   `import.meta.env.DEV` — which Vite replaces with `false` in a production
   build. Delete this block before deploying anywhere real.
   ────────────────────────────────────────────────────────────────────────── */

type DevRole = "clinician" | "super_admin"

const DEV_PREVIEW_KEY = "aura-dx-dev-preview-role"

function makeDevProfile(role: DevRole): Profile {
  const stamp = new Date().toISOString()
  return {
    id: `dev-preview-${role}`,
    email: `${role === "super_admin" ? "admin" : "clinician"}@aura-dx.local`,
    full_name: role === "super_admin" ? "Preview Admin" : "Preview Clinician",
    role,
    status: "approved",
    clinic_id: null,
    phone: null,
    specialization: role === "super_admin" ? null : "Pulmonology",
    license_number: null,
    last_login_at: stamp,
    created_at: stamp,
    updated_at: stamp,
    avatar_url: null,
  }
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export { AuthContext }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [devPreview, setDevPreview] = useState<Profile | null>(() => {
    /* Read straight into initial state rather than restoring in an effect, so
       a refresh keeps the role without an extra render pass. */
    if (!import.meta.env.DEV || typeof window === "undefined") return null
    const saved = window.sessionStorage.getItem(DEV_PREVIEW_KEY)
    return saved === "clinician" || saved === "super_admin" ? makeDevProfile(saved) : null
  })
  const skipAuthEventRef = useRef(false)
  const pendingLoginUserIdRef = useRef<string | null>(null)

  const fetchProfile = useCallback(async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single()
      if (error) throw error

      if (data.status === "approved") {
        setUser(data)
      } else {
        setUser(null)
        await supabase.auth.signOut()
      }
    } catch (error) {
      console.error("Error fetching profile:", error)
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let ignore = false

    const initAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!ignore) {
        if (session?.user) {
          setAccessToken(session.access_token)
          await fetchProfile(session.user.id)
        } else {
          setLoading(false)
        }
      }
    }
    initAuth()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "INITIAL_SESSION") return
      if (session?.user) {
        setAccessToken(session.access_token)
        if (!skipAuthEventRef.current) {
          await fetchProfile(session.user.id)
        }
      } else {
        setUser(null)
        setAccessToken(null)
        setLoading(false)
      }
    })

    return () => {
      ignore = true
      subscription.unsubscribe()
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    skipAuthEventRef.current = true
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      skipAuthEventRef.current = false
      return { error: new Error(error.message) }
    }

    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (authUser) {
      let profile: { status: string; last_login_at: string | null; role: string } | null = null
      try {
        const { data } = await supabase
          .from("profiles")
          .select("status, last_login_at, role")
          .eq("id", authUser.id)
          .single()
        profile = data
      } catch (e) {
        console.error("Error fetching profile status:", e)
      }

      if (profile) {
        const accountStatus = profile.status as "pending" | "approved" | "rejected" | "deleted"
        if (profile.status !== "approved") {
          await supabase.auth.signOut()
          skipAuthEventRef.current = false
          return { error: null, accountStatus }
        }

        if (!profile.last_login_at && profile.role !== "super_admin") {
          pendingLoginUserIdRef.current = authUser.id
          skipAuthEventRef.current = false
          return { error: null, accountStatus: "approved" as const }
        }
      }

      await fetchProfile(authUser.id)
    }

    skipAuthEventRef.current = false
    return { error: null }
  }, [fetchProfile])

  const confirmLogin = useCallback(async () => {
    const userId = pendingLoginUserIdRef.current
    if (userId) {
      pendingLoginUserIdRef.current = null
      await fetchProfile(userId)
    }
  }, [fetchProfile])

  const signUp = useCallback(async (data: {
    email: string
    password: string
    full_name: string
    role: "clinician" | "admin"
    phone?: string
    specialization?: string
    license_number?: string
  }) => {
    skipAuthEventRef.current = true
    const { data: signUpData, error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: {
          full_name: data.full_name,
          role: data.role,
          phone: data.phone,
          specialization: data.specialization,
          license_number: data.license_number,
        },
      },
    })
    console.log("[signUp] signUpData:", signUpData?.user?.id, signUpData?.user?.email, signUpData?.session)
    let autoApproved = false
    if (!error && signUpData?.user) {
      const { data: { user: authUser } } = await supabase.auth.getUser()
      console.log("[signUp] getUser:", authUser?.id, authUser?.email)
      if (authUser) {
        try {
          const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("status")
            .eq("id", authUser.id)
            .single()
          console.log("[signUp] profile query:", { profile, profileError })
          autoApproved = profile?.status === "approved"
        } catch (e) {
          console.error("[signUp] profile query error:", e)
        }
      }
      if (!autoApproved) {
        await supabase.auth.signOut()
      }
    } else {
      console.error("[signUp] signUp error:", error)
    }
    skipAuthEventRef.current = false
    return { error: error ? new Error(error.message) : null, autoApproved }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    /* Clears the dev preview too, so the sidebar's Sign out actually returns
       you to the real login form rather than silently re-entering the preview. */
    if (import.meta.env.DEV) {
      sessionStorage.removeItem(DEV_PREVIEW_KEY)
      setDevPreview(null)
    }
    setUser(null)
  }, [])

  const devPreviewSignIn = useCallback((role: DevRole) => {
    if (!import.meta.env.DEV) return
    sessionStorage.setItem(DEV_PREVIEW_KEY, role)
    setDevPreview(makeDevProfile(role))
  }, [])

  const devPreviewExit = useCallback(() => {
    if (!import.meta.env.DEV) return
    sessionStorage.removeItem(DEV_PREVIEW_KEY)
    setDevPreview(null)
  }, [])

  const signInWithOAuth = useCallback(async (provider: "google") => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: {
          prompt: "select_account",
        },
      },
    })
    return { error: error ? new Error(error.message) : null }
  }, [])

  const refreshUser = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user) {
      await fetchProfile(session.user.id)
    }
  }, [fetchProfile])

  /* The preview takes precedence so the guard and the shell both see a user. In a
     production build `devPreview` is always null and this collapses back to
     `user`. */
  const effectiveUser = devPreview ?? user

  const contextValue = useMemo<AuthContextType>(() => {
    const base = {
      user: effectiveUser,
      loading,
      accessToken,
      signIn,
      signUp,
      signInWithOAuth,
      signOut,
      refreshUser,
      confirmLogin,
    }

    /* Everything past this line is unreachable in a production build, where Vite
       folds `import.meta.env.DEV` to `false` and the early return fires — so
       Rollup drops the dev keys and the placeholder token from `dist` entirely.

       The placeholder token matters: half the authenticated pages gate their
       fetches on `user && accessToken`, so without it the preview shows a user
       but never loads any data. The value is never sent anywhere real — the dev
       mock ignores the Authorization header, and there is no backend to receive
       it. */
    if (!import.meta.env.DEV) return base as AuthContextType

    return devPreview
      ? { ...base, accessToken: "dev-preview-token", devPreviewSignIn, devPreviewExit }
      : { ...base, devPreviewSignIn, devPreviewExit }
  }, [
    effectiveUser,
    loading,
    accessToken,
    devPreview,
    signIn,
    signUp,
    signInWithOAuth,
    signOut,
    refreshUser,
    confirmLogin,
    devPreviewSignIn,
    devPreviewExit,
  ])

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}