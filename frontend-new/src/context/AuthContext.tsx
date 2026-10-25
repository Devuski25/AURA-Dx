"use client"

import { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from "react"
import { supabase } from "@/lib/supabase"
import { SESSION_EXPIRED_EVENT } from "@/lib/api"
import { clearAll as clearCache } from "@/lib/cache"
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
  /** The clinic or hospital they work at. Free text, set at registration. */
  clinic_name: string | null
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
    clinic_name?: string
  }) => Promise<{ error: Error | null; autoApproved?: boolean }>
  /* Google sign-in lives on the Login page only. Registration is deliberately
     form-only: an OAuth sign-up skips the clinic-name field the rest of the
     app is organised around, and lands in the approval queue with no clinic. */
  signInWithOAuth: (provider: "google") => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  refreshUser: () => Promise<void>
  confirmLogin: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export { AuthContext }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const skipAuthEventRef = useRef(false)
  const pendingLoginUserIdRef = useRef<string | null>(null)
  /* Whose data the page cache is currently holding. */
  const lastProfileIdRef = useRef<string | null>(null)
  /* Which profile fetch is allowed to publish its result.
   *
   * Two flows can be in flight at once -- the initial getSession() and an auth
   * state event, or a sign-out arriving while a fetch is still on the wire.
   * Without this, the slower one wins: a fetch that started before a sign-out
   * would land afterwards and put the user back, rendering a protected page
   * for a session that no longer exists. Every fetch takes the next number and
   * only publishes if it is still the newest. */
  const profileGenerationRef = useRef(0)

  const fetchProfile = useCallback(async (userId: string, prefetched?: Profile) => {
    const generation = ++profileGenerationRef.current
    /* A different account is signing in on this tab.
     *
     * The data cache is module-level, so it survives a sign-out. Left alone,
     * the clinician who signs in next is shown the previous account's list --
     * an admin's whole clinic, for example -- until that entry goes stale. A
     * page reload used to be the fix, because a reload empties the store.
     * Clearing it here makes a login do what a reload did, without one. */
    if (lastProfileIdRef.current !== userId) {
      clearCache()
      lastProfileIdRef.current = userId
    }
    try {
      let data: Profile | null = prefetched ?? null
      if (!data) {
        const res = await supabase
          .from("profiles")
          .select("*")
          .eq("id", userId)
          .single()
        if (res.error) throw res.error
        data = res.data as Profile
      }

      /* Somebody signed out, or a newer fetch started, while this one was in
         flight. Its answer is about a session that is no longer current. */
      if (generation !== profileGenerationRef.current) return

      if (data.status === "approved") {
        setUser(data)
      } else {
        setUser(null)
        /* The callback page is the one place that must be allowed to READ the
           session before it is torn down.

           It signs the person out itself, after working out which screen to
           show. Signing out here first made that impossible: the page asked
           "who just signed in?", Supabase had no session any more, and every
           rejected or pending Google login ended on "Authentication timed
           out" instead of the screen that explains what happened. */
        if (!window.location.pathname.startsWith("/auth/callback")) {
          await supabase.auth.signOut()
        }
      }
    } catch (error) {
      if (generation === profileGenerationRef.current) {
        console.error("Error fetching profile:", error)
        setUser(null)
      }
    } finally {
      if (generation === profileGenerationRef.current) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    let ignore = false

    /* A 401 anywhere in the app means the access token is gone, which after an
       hour of an open tab is routine rather than exceptional. Left unhandled it
       presented as "Analysis failed: Not authenticated" and, with the detail
       passed through, as a bare internal-server-error toast -- neither of which
       tells the clinician that signing in again is the whole fix.
       Tearing the session down here routes them to Login with a reason. */
    const onSessionExpired = async () => {
      profileGenerationRef.current++
      setUser(null)
      setAccessToken(null)
      setLoading(false)
      try {
        await supabase.auth.signOut()
      } catch {
        /* the session is already unusable; nothing to recover */
      }
      if (typeof window !== "undefined") {
        window.location.href = "/login?reason=session-expired"
      }
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onSessionExpired)

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
        /* No session: anything still in flight belongs to the session that
           just ended, so its result must not be published. */
        profileGenerationRef.current++
        setUser(null)
        setAccessToken(null)
        setLoading(false)
        /* Nothing on screen belongs to anybody now. */
        clearCache()
        lastProfileIdRef.current = null
      }
    })

    return () => {
      ignore = true
      subscription.unsubscribe()
      window.removeEventListener(SESSION_EXPIRED_EVENT, onSessionExpired)
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    skipAuthEventRef.current = true
    const { data: signInData, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      skipAuthEventRef.current = false
      return { error: new Error(error.message) }
    }

    /* signInWithPassword already hands back the user.
     *
     * This used to be followed by a getUser() round trip and then, once the
     * status was known good, a SECOND full profile query inside fetchProfile --
     * three calls before the dashboard could paint, two of them asking
     * questions the first answer already contained. One query is enough, and
     * the row it returns is handed straight to fetchProfile. */
    const authUser = signInData.user
    if (authUser) {
      let profile: Profile | null = null
      try {
        const { data } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", authUser.id)
          .single()
        profile = (data as Profile | null) ?? null
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

        await fetchProfile(authUser.id, profile)
      } else {
        /* The profile row was unreadable, so ask again through the normal
           path rather than deciding the account does not exist. */
        await fetchProfile(authUser.id)
      }
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
    clinic_name?: string
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
          /* The signup trigger copies this into profiles.clinic_name. A value
             the trigger does not know about is a value that never gets saved. */
          clinic_name: data.clinic_name,
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
    profileGenerationRef.current++
    await supabase.auth.signOut()
    setUser(null)
    /* Drop the cache with the session, so the next sign-in on this tab
       starts from nothing rather than from this account's data. */
    clearCache()
    lastProfileIdRef.current = null
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

  const contextValue = useMemo<AuthContextType>(() => ({
    user,
    loading,
    accessToken,
    signIn,
    signUp,
    signInWithOAuth,
    signOut,
    refreshUser,
    confirmLogin,
  }), [
    user,
    loading,
    accessToken,
    signIn,
    signUp,
    signInWithOAuth,
    signOut,
    refreshUser,
    confirmLogin,
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