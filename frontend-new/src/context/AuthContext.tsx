"use client"

import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from "react"
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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export { AuthContext }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const skipAuthEventRef = useRef(false)
  const pendingLoginUserIdRef = useRef<string | null>(null)

  const fetchProfile = async (userId: string) => {
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
  }

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

  const signIn = async (email: string, password: string) => {
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
  }

  const confirmLogin = async () => {
    const userId = pendingLoginUserIdRef.current
    if (userId) {
      pendingLoginUserIdRef.current = null
      await fetchProfile(userId)
    }
  }

  const signUp = async (data: {
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
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
  }

  const signInWithOAuth = async (provider: "google") => {
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
  }

  const refreshUser = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user) {
      await fetchProfile(session.user.id)
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, accessToken, signIn, signUp, signInWithOAuth, signOut, refreshUser, confirmLogin }}>
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