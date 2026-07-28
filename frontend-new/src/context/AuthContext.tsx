"use client"

import { createContext, useContext, useState, useEffect, type ReactNode } from "react"
import { supabase } from "@/lib/supabase"
import type { User } from "@supabase/supabase-js"

interface Profile {
  id: string
  email: string
  full_name: string
  role: "clinician" | "admin" | "super_admin"
  status: "pending" | "approved" | "rejected"
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
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signUp: (data: {
    email: string
    password: string
    full_name: string
    role: "clinician" | "admin"
    phone?: string
    specialization?: string
    license_number?: string
  }) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export { AuthContext }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [accessToken, setAccessToken] = useState<string | null>(null)

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single()
      if (error) throw error
      setUser(data)
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
        await fetchProfile(session.user.id)
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
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error ? new Error(error.message) : null }
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
    const { error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: { full_name: data.full_name, role: data.role },
      },
    })
    return { error: error ? new Error(error.message) : null }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
  }

  const refreshUser = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user) {
      await fetchProfile(session.user.id)
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, accessToken, signIn, signUp, signOut, refreshUser }}>
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